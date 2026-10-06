// 有 prepare 脚本的 git 依赖: 先安装 devDependencies 并执行 prepare, 再按 files 字段打包; 以及 git 依赖声明的本地依赖; Windows 上跳过
'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const coffee = require('coffee');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

const x = path.join(__dirname, '../..', 'bin', 'x.js');
const silent = { info() {}, log() {}, warn() {}, error() {} };

function commitRepo(dir) {
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init']);
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
}

async function writePackage(dir, pkg) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
}

describe('test/sources/git-prepare.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const repo = path.join(tmp, 'repo');
  const root = path.join(tmp, 'app');

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(path.join(repo, 'test'), { recursive: true });
    await fs.writeFile(
      path.join(repo, 'package.json'),
      JSON.stringify({
        name: 'prep-demo',
        version: '1.0.0',
        main: 'dist/index.js',
        files: ['dist'],
        scripts: { prepare: 'node build.js' },
        devDependencies: { pedding: '^1.1.0' },
      })
    );
    await fs.writeFile(
      path.join(repo, 'build.js'),
      "require('pedding');\nrequire('fs').mkdirSync('dist');\nrequire('fs').writeFileSync('dist/index.js', 'module.exports = 1;\\n');\n"
    );
    await fs.writeFile(path.join(repo, '.gitignore'), 'dist\nnode_modules\n');
    await fs.writeFile(path.join(repo, 'README.md'), '# prep-demo\n');
    await fs.writeFile(path.join(repo, 'test/index.test.js'), '');
    const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git(['init', '-q']);
    git(['add', '-A']);
    git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init']);
    git(['tag', 'v1.0.0']);

    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: { 'prep-demo': `git+file://${repo}#semver:^1.0.0` },
        allowScripts: { [`git+file://${repo}`]: true },
      })
    );
  });
  afterEach(cleanup);

  async function assertPrepared() {
    const pkgDir = path.join(root, 'node_modules/prep-demo');
    const files = (await fs.readdir(pkgDir)).sort();
    assert.deepEqual(files, ['README.md', 'dist', 'package.json']);
    assert.equal(await fs.readFile(path.join(pkgDir, 'dist/index.js'), 'utf8'), 'module.exports = 1;\n');
    const pkg = await helper.readJSON(path.join(pkgDir, 'package.json'));
    assert.equal(pkg._from, `prep-demo@git+file://${repo}#semver:^1.0.0`);
    assert.match(
      pkg._resolved,
      new RegExp(`^git\\+file://${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#[a-f0-9]{40}$`)
    );
    const tmpDir = path.join(root, 'node_modules/.tmp');
    assert.deepEqual(await fs.readdir(tmpDir).catch(() => []), []);
  }

  if (process.platform !== 'win32') {
    it('should install devDependencies, run prepare and pack by files', async () => {
      await npminstall({ root });
      await assertPrepared();
    });

    it('should not write np-lock.json into the built package', async () => {
      // 不按 files 白名单打包, 构建目录里多出的文件都会进入包
      const pkgFile = path.join(repo, 'package.json');
      const pkg = await helper.readJSON(pkgFile);
      delete pkg.files;
      await fs.writeFile(pkgFile, JSON.stringify(pkg));
      await fs.writeFile(path.join(repo, '.npmignore'), 'node_modules\n');
      const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      git(['add', '-A']);
      git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'no files']);
      git(['tag', 'v1.0.1']);
      const lockfileEnv = process.env.np_lockfile;
      delete process.env.np_lockfile;
      try {
        await npminstall({ root });
      } finally {
        process.env.np_lockfile = lockfileEnv;
      }
      const files = await fs.readdir(path.join(root, 'node_modules/prep-demo'));
      assert(files.includes('dist'), files.join(','));
      assert(!files.includes('np-lock.json'), files.join(','));
    });

    it('should skip prepare with ignoreScripts', async () => {
      await npminstall({ root, ignoreScripts: true });
      const files = (await fs.readdir(path.join(root, 'node_modules/prep-demo'))).sort();
      assert(!files.includes('dist'), files.join(','));
    });

    it('should skip prepare when the git dependency is not in allowScripts', async () => {
      const pkgFile = path.join(root, 'package.json');
      const pkg = await helper.readJSON(pkgFile);
      delete pkg.allowScripts;
      await fs.writeFile(pkgFile, JSON.stringify(pkg));
      await npminstall({ root });
      const files = (await fs.readdir(path.join(root, 'node_modules/prep-demo'))).sort();
      assert(!files.includes('dist'), files.join(','));
    });

    const mark = name => `node -e "require('fs').writeFileSync('${path.join(tmp, name)}', 'x')"`;
    const marked = name =>
      fs.access(path.join(tmp, name)).then(
        () => true,
        () => false
      );

    it('should not build an unreviewed repository that only has a build script', async () => {
      const buildRepo = path.join(tmp, 'build-repo');
      await writePackage(buildRepo, {
        name: 'build-demo',
        version: '1.0.0',
        scripts: { build: 'echo build' },
        devDependencies: { evil: 'file:./evil' },
      });
      await writePackage(path.join(buildRepo, 'evil'), {
        name: 'evil',
        version: '1.0.0',
        scripts: { prepare: mark('evil-prepare'), prepack: mark('evil-prepack') },
      });
      commitRepo(buildRepo);
      await writePackage(root, {
        name: 'app',
        version: '1.0.0',
        dependencies: { 'build-demo': `git+file://${buildRepo}` },
      });
      await npminstall({ root, console: silent });
      assert.equal(await marked('evil-prepare'), false);
      assert.equal(await marked('evil-prepack'), false);
    });

    it('should approve an unreviewed git dependency that only has a build script', async () => {
      const buildRepo = path.join(tmp, 'build-repo');
      await writePackage(buildRepo, { name: 'build-demo', version: '1.0.0', scripts: { build: 'echo build' } });
      const sha = commitRepo(buildRepo);
      await writePackage(root, {
        name: 'app',
        version: '1.0.0',
        dependencies: { 'build-demo': `git+file://${buildRepo}` },
      });
      await npminstall({ root, console: silent });
      const run = args => coffee.fork(x, args, { cwd: root });
      await run(['approve-scripts', '--pending'])
        .expect('stdout', /build-demo@1\.0\.0 \(build\)/)
        .end();
      await run(['approve-scripts', 'build-demo'])
        .expect('code', 0)
        .expect('stdout', /remove node_modules[/\\]_build-demo@1\.0\.0\+git\.[0-9a-f]{8}@build-demo and run npd again/)
        .notExpect('stdout', /npd-x rebuild/)
        .end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { [`git+file://${buildRepo}#${sha}`]: true });
    });

    it('should not run scripts of nested git and local dependencies when building an approved repository', async () => {
      const nestedRepo = path.join(tmp, 'nested-repo');
      await writePackage(nestedRepo, {
        name: 'nested',
        version: '1.0.0',
        scripts: { prepare: mark('nested-prepare') },
      });
      commitRepo(nestedRepo);
      // 外层仓库自带的 allowScripts 放行了嵌套仓库, 构建子进程不读它
      const pkgFile = path.join(repo, 'package.json');
      const pkg = await helper.readJSON(pkgFile);
      pkg.devDependencies = { nested: `git+file://${nestedRepo}`, evil: 'file:./evil' };
      pkg.allowScripts = { [`git+file://${nestedRepo}`]: true };
      await fs.writeFile(
        path.join(repo, 'build.js'),
        "require('fs').mkdirSync('dist');\nrequire('fs').writeFileSync('dist/index.js', 'module.exports = 1;\\n');\n"
      );
      await fs.writeFile(pkgFile, JSON.stringify(pkg));
      await writePackage(path.join(repo, 'evil'), {
        name: 'evil',
        version: '1.0.0',
        scripts: { prepack: mark('evil-prepack'), postinstall: mark('evil-postinstall') },
      });
      const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      git(['add', '-A']);
      git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'nested']);
      git(['tag', 'v1.0.1']);
      await npminstall({ root, console: silent });
      await assertPrepared();
      assert.equal(await marked('nested-prepare'), false);
      assert.equal(await marked('evil-prepack'), false);
      assert.equal(await marked('evil-postinstall'), false);
    });

    describe('local dependencies of a git dependency', () => {
      const hostRepo = path.join(tmp, 'host-repo');
      let sha;

      beforeEach(async () => {
        await writePackage(hostRepo, { name: 'host', version: '1.0.0', dependencies: { inner: 'file:./inner' } });
        await writePackage(path.join(hostRepo, 'inner'), {
          name: 'inner',
          version: '1.0.0',
          scripts: { postinstall: mark('inner-postinstall'), prepack: mark('inner-prepack') },
        });
        sha = commitRepo(hostRepo);
        await writePackage(root, { name: 'app', version: '1.0.0', dependencies: { host: `git+file://${hostRepo}` } });
        // 按项目根解析时会装上的同名诱饵
        await writePackage(path.join(root, 'inner'), { name: 'inner', version: '2.0.0' });
      });

      const installedInner = () =>
        helper.readJSON(path.join(root, 'node_modules/host/node_modules/inner/package.json'));

      it('should resolve them in the git dependency and review their scripts as the git dependency', async () => {
        const warnings = [];
        await npminstall({ root, console: { ...silent, warn: (...args) => warnings.push(args.join(' ')) } });
        const inner = await installedInner();
        assert.equal(inner.version, '1.0.0');
        assert.equal(inner._scriptsOwner, `git+file://${hostRepo}#${sha}`);
        assert.equal(await marked('inner-postinstall'), false);
        assert.equal(await marked('inner-prepack'), false);
        assert(
          warnings.some(line => line.includes(`inner@file:./inner (declared by git+file://${hostRepo}#${sha})`)),
          warnings.join('\n')
        );

        const run = args => coffee.fork(x, args, { cwd: root });
        await run(['approve-scripts', '--pending'])
          .expect('stdout', new RegExp(`inner@1\\.0\\.0 \\(declared by git\\+file://.*#${sha}\\) \\(postinstall\\)`))
          .end();
        await run(['approve-scripts', 'inner']).expect('code', 0).end();
        const pkg = await helper.readJSON(path.join(root, 'package.json'));
        assert.deepEqual(pkg.allowScripts, { [`git+file://${hostRepo}#${sha}`]: true });
        await run(['rebuild', 'inner']).expect('code', 0).end();
        assert.equal(await marked('inner-postinstall'), true);
        assert.equal(await marked('inner-prepack'), false);
      });

      it('should run only install scripts after the git dependency is approved', async () => {
        const pkgFile = path.join(root, 'package.json');
        const pkg = await helper.readJSON(pkgFile);
        pkg.allowScripts = { [`git+file://${hostRepo}`]: true };
        await fs.writeFile(pkgFile, JSON.stringify(pkg));
        await npminstall({ root, console: silent });
        assert.equal((await installedInner()).version, '1.0.0');
        assert.equal(await marked('inner-postinstall'), true);
        assert.equal(await marked('inner-prepack'), false);
      });
    });
  }
});
