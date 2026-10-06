// 有 prepare 脚本的 git 依赖: 先安装 devDependencies 并执行 prepare, 再按 files 字段打包; Windows 上跳过
'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const npminstall = require('./npminstall');
const helper = require('./helper');

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

    it('should still run prepare with ignoreScripts', async () => {
      await npminstall({ root, ignoreScripts: true });
      await assertPrepared();
    });
  }
});
