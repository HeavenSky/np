// git / 本地包的 store 目录名带来源标识: 同版本号的新提交装上新内容, 自称 registry 包的同名同版本不占用 registry 包的目录; Windows 上跳过
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const npminstall = require('./npminstall');
const helper = require('./helper');
const { exists } = require('../lib/utils');

async function commitRepo(dir, files) {
  await fs.mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  if (!(await exists(path.join(dir, '.git')))) git(['init', '-q']);
  git(['add', '-A']);
  git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'update']);
}

describe('test/store-source.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const repo = path.join(tmp, 'repo');
  const root = path.join(tmp, 'app');
  const store = path.join(root, 'node_modules/.store');

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(root, { recursive: true });
  });
  afterEach(cleanup);

  const writeRootPkg = dependencies =>
    fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies }));
  const readInstalled = (name, file) => fs.readFile(path.join(root, 'node_modules', name, file), 'utf8');

  if (process.platform !== 'win32') {
    it('should install the new commit of a git dependency whose version is unchanged', async () => {
      await commitRepo(repo, { 'package.json': { name: 'src-demo', version: '1.0.0' }, 'index.js': 'one' });
      await writeRootPkg({ 'src-demo': `git+file://${repo}` });
      await npminstall({ root });
      assert.equal(await readInstalled('src-demo', 'index.js'), 'one');

      await commitRepo(repo, { 'index.js': 'two' });
      await npminstall({ root });
      assert.equal(await readInstalled('src-demo', 'index.js'), 'two');
      const entries = (await fs.readdir(store)).filter(entry => entry.startsWith('src-demo@'));
      assert.equal(entries.length, 2, entries.join(', '));
      for (const entry of entries) assert.match(entry, /^src-demo@1\.0\.0\+git\.[a-f0-9]{8}$/);
    });

    it('should not let git or local packages occupy the store directory of a registry package', async () => {
      const fake = { 'package.json': { name: 'pedding', version: '1.1.0' }, 'index.js': 'module.exports = "fake";' };
      await commitRepo(repo, fake);
      const localDir = path.join(root, 'fake-pedding');
      await fs.mkdir(localDir, { recursive: true });
      for (const [file, content] of Object.entries(fake)) {
        await fs.writeFile(path.join(localDir, file), typeof content === 'string' ? content : JSON.stringify(content));
      }
      for (const [spec, source] of [
        [`git+file://${repo}`, 'git'],
        ['file:./fake-pedding', 'file'],
      ]) {
        await writeRootPkg({ pedding: spec });
        await npminstall({ root });
        assert.equal(await readInstalled('pedding', 'index.js'), 'module.exports = "fake";');
        const real = await fs.realpath(path.join(root, 'node_modules/pedding'));
        assert.match(path.relative(store, real), new RegExp(`^pedding@1\\.1\\.0\\+${source}\\.[a-f0-9]{8}`));

        // 已装的版本满足声明时 needInstall 保留它, 删掉链接让 registry 包重新经过 store
        await fs.unlink(path.join(root, 'node_modules/pedding'));
        await writeRootPkg({ pedding: '1.1.0' });
        await npminstall({ root });
        assert.notEqual(await readInstalled('pedding', 'index.js'), 'module.exports = "fake";');
        assert.equal(
          await fs.realpath(path.join(root, 'node_modules/pedding')),
          await fs.realpath(path.join(store, 'pedding@1.1.0/node_modules/pedding'))
        );
      }
    });
  }
});
