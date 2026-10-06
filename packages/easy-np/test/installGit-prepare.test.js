// 有 prepare 脚本的 git 依赖: 先安装 devDependencies 并执行 prepare, 再按 files 字段打包; Windows 上跳过
const assert = require('node:assert');
const util = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const npminstall = require('./npminstall');
const helper = require('./helper');
const { exists } = require('../lib/utils');

// 把 files 写入 dir 并提交为一个 git 仓库; 值为对象时写成 JSON
async function commitRepo(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q']);
  git(['add', '-A']);
  git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init']);
}

// 写标记文件的脚本, 用于断言脚本是否执行
const touch = file => `node -e "require('fs').writeFileSync('${file}', '')"`;

describe('test/installGit-prepare.test.js', () => {
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

    it('should not build an unapproved repo that only has a build script', async () => {
      const buildRepo = path.join(tmp, 'build-repo');
      const marker = path.join(tmp, 'evil-prepare');
      await commitRepo(buildRepo, {
        'package.json': {
          name: 'build-demo',
          version: '1.0.0',
          scripts: { build: 'echo build' },
          devDependencies: { evil: 'file:./evil' },
        },
        'evil/package.json': { name: 'evil', version: '1.0.0', scripts: { prepare: touch(marker) } },
      });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { 'build-demo': `git+file://${buildRepo}` } })
      );
      await npminstall({ root });
      assert(await exists(path.join(root, 'node_modules/build-demo/package.json')));
      assert.equal(await exists(marker), false);
    });

    it('should not build nested git dependencies or run local prepack in the build', async () => {
      const nestedRepo = path.join(tmp, 'nested-repo');
      const outerRepo = path.join(tmp, 'outer-repo');
      const nestedMarker = path.join(tmp, 'nested-prepare');
      const evilMarker = path.join(tmp, 'evil-prepack');
      await commitRepo(nestedRepo, {
        'package.json': { name: 'nested', version: '1.0.0', scripts: { prepare: touch(nestedMarker) } },
      });
      await commitRepo(outerRepo, {
        'package.json': {
          name: 'outer',
          version: '1.0.0',
          files: ['dist'],
          scripts: { prepare: 'node build.js' },
          devDependencies: { nested: `git+file://${nestedRepo}`, evil: 'file:./evil' },
          allowScripts: { [`git+file://${nestedRepo}`]: true },
        },
        'build.js': "require('fs').mkdirSync('dist');\nrequire('fs').writeFileSync('dist/index.js', '');\n",
        '.gitignore': 'dist\nnode_modules\n',
        'evil/package.json': { name: 'evil', version: '1.0.0', scripts: { prepack: touch(evilMarker) } },
      });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '1.0.0',
          dependencies: { outer: `git+file://${outerRepo}` },
          allowScripts: { [`git+file://${outerRepo}`]: true },
        })
      );
      await npminstall({ root });
      assert(await exists(path.join(root, 'node_modules/outer/dist/index.js')));
      assert.equal(await exists(nestedMarker), false);
      assert.equal(await exists(evilMarker), false);
    });
  }
});

// 依赖声明的 file: 目录按声明者目录解析, 脚本按声明者在 allowScripts 中的放行执行; Windows 上跳过
describe('test/installGit-prepare.test.js local dependencies of a git dependency', () => {
  const [tmp, cleanup] = helper.tmp();
  const repo = path.join(tmp, 'host-repo');
  const root = path.join(tmp, 'app');
  const postinstallMarker = path.join(tmp, 'inner-postinstall');
  const prepackMarker = path.join(tmp, 'inner-prepack');
  const decoyMarker = path.join(tmp, 'decoy-postinstall');
  const innerDir = path.join(root, 'node_modules/.store/host@1.0.0/node_modules/inner');

  beforeEach(async () => {
    await cleanup();
    await commitRepo(repo, {
      'package.json': { name: 'host', version: '1.0.0', dependencies: { inner: 'file:./inner' } },
      'inner/package.json': {
        name: 'inner',
        version: '1.0.0',
        scripts: { postinstall: touch(postinstallMarker), prepack: touch(prepackMarker) },
      },
    });
    await fs.mkdir(path.join(root, 'inner'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'inner/package.json'),
      JSON.stringify({ name: 'inner', version: '2.0.0', scripts: { postinstall: touch(decoyMarker) } })
    );
  });
  afterEach(cleanup);

  const writeRootPkg = extra =>
    fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { host: `git+file://${repo}` }, ...extra })
    );

  if (process.platform !== 'win32') {
    it('should resolve it from the git dependency and skip its scripts until the git dependency is approved', async () => {
      await writeRootPkg();
      const warnings = [];
      await npminstall({
        root,
        console: { info() {}, log() {}, warn: (...args) => warnings.push(util.format(...args)), error() {} },
      });
      assert.equal((await helper.readJSON(path.join(innerDir, 'package.json'))).version, '1.0.0');
      assert.equal(await exists(postinstallMarker), false);
      assert.equal(await exists(prepackMarker), false);
      assert.equal(await exists(decoyMarker), false);
      const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(
        warnings.join('\n'),
        new RegExp(`inner@file:\\./inner \\(declared by git\\+file://${escaped}#[a-f0-9]{40}\\) \\(postinstall\\)`)
      );
    });

    it('should run only its dependency scripts after the git dependency is approved', async () => {
      await writeRootPkg({ allowScripts: { [`git+file://${repo}`]: true } });
      await npminstall({ root });
      assert.equal((await helper.readJSON(path.join(innerDir, 'package.json'))).version, '1.0.0');
      assert.equal(await exists(postinstallMarker), true);
      assert.equal(await exists(prepackMarker), false);
      assert.equal(await exists(decoyMarker), false);
    });
  }
});
