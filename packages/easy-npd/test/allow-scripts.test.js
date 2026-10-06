const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');
const allowScripts = require('../lib/allow_scripts');

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

    it('should write git and url keys without credentials and still match old keys with credentials', () => {
      const git = { git: 'git+https://user:tok@example.com/x/y.git#abc' };
      const url = { url: 'https://user:tok@example.com/y/-/y-1.0.0.tgz' };
      assert.equal(allowScripts.keyOf(git), 'git+https://example.com/x/y.git#abc');
      assert.equal(allowScripts.keyOf(git, false), 'git+https://example.com/x/y.git');
      assert.equal(allowScripts.keyOf(url), 'https://example.com/y/-/y-1.0.0.tgz');
      assert.equal(allowScripts.check({ 'git+https://example.com/x/y.git': true }, git), true);
      assert.equal(allowScripts.check({ 'git+https://user:old@example.com/x/y.git#abc': true }, git), true);
      assert.equal(allowScripts.check({ 'https://example.com/y/-/y-1.0.0.tgz': true }, url), true);
      assert.equal(allowScripts.check({ 'https://user:old@example.com/y/-/y-1.0.0.tgz': true }, url), true);
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
        .expect('stderr', /npd-x approve-scripts postinstall-hello && npd-x rebuild postinstall-hello/)
        .end();

      await run(x, ['approve-scripts', '--pending']).expect('stdout', /postinstall-hello@1.0.0 \(postinstall\)/).end();
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

    it('should not take the next package name as the value of a boolean switch', async () => {
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
      await run(helper.npminstall, ['--dangerously-allow-all-scripts', 'postinstall-hello@1.0.0'])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.match(pkg.dependencies['postinstall-hello'], /^\^?1\.0\.0$/);

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
      await run(helper.npminstall, []).expect('code', 0).expect('stderr', /were skipped/).end();
      await run(x, ['approve-scripts', 'postinstall-hello']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { [url]: true });
      await run(x, ['rebuild', 'postinstall-hello']).expect('code', 0).expect('stdout', /run on postinstall-hello/).end();
    });
  });

  describe('tarball url with credentials', () => {
    const [tmp, cleanup] = helper.tmp();
    const root = path.join(tmp, 'root');
    const marker = path.join(tmp, 'marker');
    let registry;
    const run = (bin, args) =>
      coffee.fork(bin, args, { cwd: root, env: { ...process.env, np_cache: path.join(tmp, 'cache') } });

    before(async () => {
      await cleanup();
      registry = helper.createRegistry('local', []);
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
      const script = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'x')"`;
      registry.packages['url-dep'] = {
        '1.0.0': await helper.packTarball(tmp, { name: 'url-dep', version: '1.0.0', scripts: { postinstall: script } }),
      };
    });
    after(() => registry.server.close());

    it('should approve by the url without credentials and run the script on the next install', async () => {
      const port = registry.server.address().port;
      const url = `http://user:s3cret@127.0.0.1:${port}/url-dep/-/url-dep-1.0.0.tgz`;
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'url-dep': url } })
      );
      await run(helper.npminstall, [])
        .expect('code', 0)
        .expect('stderr', /were skipped/)
        .end();
      await assert.rejects(fs.access(marker));
      await run(x, ['approve-scripts', 'url-dep'])
        .expect('code', 0)
        .notExpect('stdout', /s3cret/)
        .end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { [`http://127.0.0.1:${port}/url-dep/-/url-dep-1.0.0.tgz`]: true });

      await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
      await run(helper.npminstall, [])
        .expect('code', 0)
        .notExpect('stderr', /were skipped/)
        .end();
      await fs.access(marker);
    });
  });

  describe('manifest confusion', () => {
    const [tmp, cleanup] = helper.tmp();
    const root = path.join(tmp, 'root');
    const marker = path.join(tmp, 'marker');
    let registry;
    const run = (bin, args) =>
      coffee.fork(bin, args, { cwd: root, env: { ...process.env, np_cache: path.join(tmp, 'cache') } });

    before(async () => {
      await cleanup();
      registry = helper.createRegistry('local', []);
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
      // registry 上的 evil@1.0.0, tarball 里的 package.json 自称已放行的 trusted@9.9.9
      const script = `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'x')"`;
      registry.packages.evil = {
        '1.0.0': await helper.packTarball(tmp, { name: 'trusted', version: '9.9.9', scripts: { postinstall: script } }),
      };
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'root',
          version: '1.0.0',
          dependencies: { evil: '1.0.0' },
          allowScripts: { trusted: true },
        })
      );
    });
    after(() => registry.server.close());

    it('should identify packages by the registry name and version', async () => {
      await run(helper.npminstall, [`--registry=${registry.prefix}`])
        .expect('code', 0)
        .expect('stderr', /manifest mismatch/)
        .expect('stderr', /evil@1\.0\.0 \(postinstall\)/)
        .end();
      await assert.rejects(fs.access(marker));
      assert((await fs.lstat(path.join(root, 'node_modules/evil'))).isSymbolicLink());
      await assert.rejects(fs.lstat(path.join(root, 'node_modules/trusted')));

      await run(x, ['approve-scripts', '--pending'])
        .expect('stdout', /evil@1\.0\.0 \(postinstall\)/)
        .end();
      await run(x, ['rebuild', 'evil'])
        .expect('code', 0)
        .expect('stderr', /evil@1\.0\.0 \(postinstall\)/)
        .expect('stderr', /were skipped/)
        .end();
      await assert.rejects(fs.access(marker));

      await run(x, ['approve-scripts', 'evil']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { trusted: true, 'evil@1.0.0': true });
      await run(x, ['rebuild', 'evil', '-d'])
        .expect('code', 0)
        .expect('stdout', /rebuilt evil@1\.0\.0/)
        .end();
      await fs.access(marker);
    });

    it('should save the registry name and version to package.json', async () => {
      await run(helper.npminstall, [`--registry=${registry.prefix}`, '--save-exact', 'evil'])
        .expect('code', 0)
        .end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.dependencies, { evil: '1.0.0' });
    });
  });
});
