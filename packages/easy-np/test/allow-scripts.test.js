const assert = require('node:assert');
const util = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');
const allowScripts = require('../lib/allow_scripts');
const npminstall = require('./npminstall');
const { exists } = require('../lib/utils');

const x = path.join(__dirname, '..', 'bin', 'x.js');

describe('test/allow-scripts.test.js', () => {
  describe('check()', () => {
    const id = (name, version) => ({ name, version });

    it('should match names, pinned versions and exact version lists', () => {
      const policy = { a: true, 'b@1.0.0 || 1.0.2': true, 'c@*': true };
      assert.equal(allowScripts.check(policy, id('a', '9.9.9')), true);
      assert.equal(allowScripts.check(policy, id('b', '1.0.2')), true);
      assert.equal(allowScripts.check(policy, id('b', '1.0.1')), null);
      assert.equal(allowScripts.check(policy, id('c', '1.0.0')), true);
      assert.equal(allowScripts.check(policy, id('d', '1.0.0')), null);
    });

    it('should let false win over true', () => {
      const policy = { d: true, 'd@2.0.0': false };
      assert.equal(allowScripts.check(policy, id('d', '2.0.0')), false);
      assert.equal(allowScripts.check(policy, id('d', '1.0.0')), true);
    });

    it('should match git dependencies by repository and optional commit', () => {
      const git = { git: 'git+ssh://git@github.com/x/y.git#abc' };
      assert.equal(allowScripts.check({ 'github:x/y': true }, git), true);
      assert.equal(allowScripts.check({ 'git+https://github.com/x/y.git#abc': true }, git), true);
      assert.equal(allowScripts.check({ 'github:x/y#def': true }, git), null);
      assert.equal(allowScripts.check({ y: true }, git), null);
    });

    it('should ignore ranges and dist-tags with a warning', () => {
      const warnings = [];
      const state = allowScripts.load({
        argv: { 'allow-scripts': 'a@^1.0.0,b@latest,c' },
        logger: { warn: (...args) => warnings.push(args.join(' ')) },
      });
      assert.deepEqual(state.policy, { c: true });
      assert.equal(warnings.length, 2);
    });

    it('should merge repeated --allow-scripts', () => {
      const state = allowScripts.load({ argv: { 'allow-scripts': ['a', 'b,c'] } });
      assert.deepEqual(state.policy, { a: true, b: true, c: true });
    });
  });

  describe('install', () => {
    const [root, cleanup] = helper.tmp();
    const writePkg = extra =>
      fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'postinstall-hello': '1.0.0' }, ...extra })
      );
    const run = (bin, args) => coffee.fork(bin, args, { cwd: root });

    beforeEach(cleanup);
    afterEach(cleanup);

    it('should skip unreviewed dependency scripts, approve them and rebuild', async () => {
      await writePkg();
      await run(helper.npminstall, ['--foreground-scripts'])
        .expect('code', 0)
        .notExpect('stdout', /run on postinstall-hello/)
        .expect('stderr', /1 package\(s\) have install scripts that are not in allowScripts and were skipped/)
        .expect('stderr', /postinstall-hello@1.0.0 \(postinstall\)/)
        .expect('stderr', /np-x approve-scripts postinstall-hello && np-x rebuild postinstall-hello/)
        .end();

      await run(x, ['approve-scripts', '--pending'])
        .expect('stdout', /postinstall-hello@1.0.0 \(postinstall\)/)
        .end();
      await run(x, ['approve-scripts', 'postinstall-hello']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { 'postinstall-hello@1.0.0': true });

      await run(x, ['rebuild', 'postinstall-hello'])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
    });

    it('should fail with --strict-allow-scripts and stay quiet for denied packages', async () => {
      await writePkg();
      await run(helper.npminstall, ['--strict-allow-scripts'])
        .expect('code', 1)
        .expect('stderr', /were blocked/)
        .end();

      await cleanup();
      await writePkg({ allowScripts: { 'postinstall-hello': false } });
      await run(helper.npminstall, ['--strict-allow-scripts', '--foreground-scripts'])
        .expect('code', 0)
        .notExpect('stderr', /allowScripts/)
        .notExpect('stdout', /run on postinstall-hello/)
        .end();
    });

    it('should run every script with --dangerously-allow-all-scripts', async () => {
      await writePkg();
      await run(helper.npminstall, ['--dangerously-allow-all-scripts', '--foreground-scripts'])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
    });

    it('should not take the package after a switch as its value', async () => {
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
      await run(helper.npminstall, [
        '--foreground-scripts',
        '--dangerously-allow-all-scripts',
        'postinstall-hello@1.0.0',
      ])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert(pkg.dependencies['postinstall-hello']);

      await cleanup();
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
      await run(helper.npminstall, ['--strict-allow-scripts', 'postinstall-hello@1.0.0'])
        .expect('code', 1)
        .expect('stderr', /were blocked/)
        .end();
    });

    it('should deny scripts by name and drop existing approvals', async () => {
      await writePkg({ allowScripts: { 'postinstall-hello@1.0.0': true } });
      await run(helper.npminstall, []).expect('code', 0).end();
      await run(x, ['deny-scripts', 'postinstall-hello', 'never-installed']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { 'postinstall-hello': false, 'never-installed': false });
      await run(x, ['approve-scripts', '--pending'])
        .expect('stdout', /all installed packages with install scripts are reviewed/)
        .end();
    });

    it('should not report rebuilt for packages whose scripts were skipped', async () => {
      await writePkg();
      await run(helper.npminstall, []).expect('code', 0).end();
      await run(x, ['rebuild', 'postinstall-hello', '-d'])
        .expect('code', 0)
        .notExpect('stdout', /rebuilt postinstall-hello/)
        .notExpect('stdout', /run on postinstall-hello/)
        .expect('stderr', /were skipped/)
        .end();
    });

    it('should approve tarball url dependencies by url', async () => {
      const url = 'https://registry.npmmirror.com/postinstall-hello/-/postinstall-hello-1.0.0.tgz';
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'postinstall-hello': url } })
      );
      await run(helper.npminstall, [])
        .expect('code', 0)
        .expect('stderr', /were skipped/)
        .end();
      await run(x, ['approve-scripts', 'postinstall-hello']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { [url]: true });
      await run(x, ['rebuild', 'postinstall-hello'])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
    });
  });

  describe('url dependencies with credentials', () => {
    const [tmp, cleanup] = helper.tmp();
    const root = path.join(tmp, 'app');
    const marker = path.join(root, 'node_modules/auth-hello/postinstall.marker');
    const run = (bin, args) => coffee.fork(bin, args, { cwd: root });
    let registry;

    before(async () => {
      registry = helper.createRegistry('registry', []);
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
    });
    after(() => registry.server.close());

    beforeEach(async () => {
      await cleanup();
      const tarball = await helper.packTarball(tmp, {
        name: 'auth-hello',
        version: '1.0.0',
        scripts: { postinstall: "node -e \"require('fs').writeFileSync('postinstall.marker', '')\"" },
      });
      registry.packages = { 'auth-hello': { '1.0.0': tarball } };
      await fs.mkdir(root, { recursive: true });
    });
    afterEach(cleanup);

    it('should approve them without writing the credentials and run their scripts', async () => {
      const port = registry.server.address().port;
      const url = `http://user:s3cret@127.0.0.1:${port}/auth-hello/-/auth-hello-1.0.0.tgz`;
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'auth-hello': url } })
      );
      const { stdout, stderr } = await run(helper.npminstall, [`--registry=${registry.prefix}`])
        .expect('code', 0)
        .expect('stderr', /were skipped/)
        .end();
      assert(!`${stdout}${stderr}`.includes('s3cret'));
      assert.equal(await exists(marker), false);

      await run(x, ['approve-scripts', 'auth-hello'])
        .expect('code', 0)
        .notExpect('stdout', /s3cret/)
        .end();
      const { allowScripts: approved } = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(approved, {
        [`http://127.0.0.1:${port}/auth-hello/-/auth-hello-1.0.0.tgz`]: true,
      });

      await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
      await run(helper.npminstall, [`--registry=${registry.prefix}`])
        .expect('code', 0)
        .end();
      assert.equal(await exists(marker), true);
    });

    it('should still match approvals written with the credentials', async () => {
      const port = registry.server.address().port;
      const url = `http://user:s3cret@127.0.0.1:${port}/auth-hello/-/auth-hello-1.0.0.tgz`;
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { 'auth-hello': `http://127.0.0.1:${port}/auth-hello/-/auth-hello-1.0.0.tgz` },
          allowScripts: { [url]: true },
        })
      );
      await run(helper.npminstall, [`--registry=${registry.prefix}`])
        .expect('code', 0)
        .end();
      assert.equal(await exists(marker), true);
    });
  });

  // tarball 内 package.json 自称其他包时, 放行, 跳过列表, 链接名与重跑都按 registry 上的 name@version
  describe('manifest confusion', () => {
    const [tmp, cleanup] = helper.tmp();
    const root = path.join(tmp, 'app');
    const marker = path.join(root, 'node_modules/evil/postinstall.marker');
    const run = (bin, args) => coffee.fork(bin, args, { cwd: root });
    let registry;

    before(async () => {
      registry = helper.createRegistry('registry', []);
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
    });
    after(() => registry.server.close());

    beforeEach(async () => {
      await cleanup();
      const tarball = await helper.packTarball(tmp, {
        name: 'trusted',
        version: '9.9.9',
        scripts: { postinstall: "node -e \"require('fs').writeFileSync('postinstall.marker', '')\"" },
      });
      registry.packages = { evil: { '1.0.0': tarball } };
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { evil: '1.0.0' },
          allowScripts: { trusted: true },
        })
      );
    });
    afterEach(cleanup);

    it('should not let the tarball borrow the approval of the name it claims', async () => {
      const warnings = [];
      await npminstall({
        root,
        registry: registry.prefix.slice(0, -1),
        cacheDir: path.join(tmp, 'cache'),
        console: { info() {}, log() {}, warn: (...args) => warnings.push(util.format(...args)), error() {} },
      });
      const output = warnings.join('\n');
      assert.match(output, /manifest mismatch/);
      assert.match(output, /evil@1\.0\.0 \(postinstall\)/);
      assert.equal(await exists(marker), false);
      assert.equal(await exists(path.join(root, 'node_modules/trusted')), false);
      assert.equal((await helper.readJSON(path.join(root, 'node_modules/evil/package.json'))).name, 'trusted');

      await run(x, ['approve-scripts', '--pending'])
        .expect('stdout', /^evil@1\.0\.0 \(postinstall\)/m)
        .end();
      await run(x, ['rebuild', 'evil'])
        .expect('code', 0)
        .expect('stderr', /evil@1\.0\.0 \(postinstall\)/)
        .notExpect('stdout', /postinstall/)
        .end();
      assert.equal(await exists(marker), false);

      await run(x, ['approve-scripts', 'evil']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { trusted: true, 'evil@1.0.0': true });
      await run(x, ['rebuild', 'evil'])
        .expect('code', 0)
        .expect('stdout', /> evil@1\.0\.0 postinstall/)
        .end();
      assert.equal(await exists(marker), true);
    });
  });
});
