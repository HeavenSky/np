const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const npminstall = require('./npminstall');
const helper = require('./helper');
const { getInstallState } = require('../lib/utils');
const { rebuild: rebuildPackages } = require('..');

describe('test/resume-install.test.js', () => {
  const [root, cleanup] = helper.tmp();
  const logFile = path.join(root, 'scripts.log');
  const flagFile = path.join(root, 'postinstall.ok');
  const pkgDir = path.join(root, 'node_modules/.store/resume-scripts@1.0.0/node_modules/resume-scripts');
  const install = (extra = {}) =>
    npminstall({
      root,
      pkgs: [{ version: helper.fixtures('resume-scripts'), type: 'local' }],
      env: { RESUME_LOG: logFile, RESUME_FLAG: flagFile },
      ...extra,
    });
  const readLog = async () => (await fs.readFile(logFile, 'utf8')).trim().split('\n');

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should continue from the failed script on next install', async () => {
    await assert.rejects(
      install(),
      /run np again to continue from where they stopped:\n {2}- .*resume-scripts.*: run postinstall error/
    );
    let pkg = (await getInstallState(pkgDir)) || {};
    // 进度标记写在 store 的状态文件里, 不修改依赖包自己的 package.json
    assert.equal((await helper.readJSON(path.join(pkgDir, 'package.json'))).__np_stage, undefined);
    assert.equal(pkg.done, true);
    assert.equal(pkg.stage, 'postinstall');
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall']);

    await fs.writeFile(flagFile, '');
    await install();
    pkg = (await getInstallState(pkgDir)) || {};
    assert.equal(pkg.stage, undefined);
    // preinstall 已成功, 不再重复执行
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall', 'postinstall']);

    // 已完成的包不再执行脚本
    await install();
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall', 'postinstall']);

    await install({ rebuild: true });
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall', 'postinstall', 'preinstall', 'postinstall']);
  });

  it('should rerun scripts of the listed packages with np-x rebuild <pkg>', async () => {
    await fs.writeFile(flagFile, '');
    await install();
    const rebuild = specs =>
      rebuildPackages({ root, rebuildSpecs: specs, env: { RESUME_LOG: logFile, RESUME_FLAG: flagFile } });
    const rebuilt = await rebuild([{ raw: 'resume-scripts@^1', name: 'resume-scripts', range: '^1' }]);
    assert.deepEqual(
      rebuilt.map(item => item.dir),
      [pkgDir]
    );
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall', 'preinstall', 'postinstall']);
    const pkg = (await getInstallState(pkgDir)) || {};
    assert.equal(pkg.stage, undefined);

    await assert.rejects(
      rebuild([{ raw: 'resume-scripts@^2', name: 'resume-scripts', range: '^2' }]),
      /resume-scripts@\^2 is not installed/
    );

    await fs.rm(flagFile);
    await assert.rejects(
      rebuild([{ raw: 'resume-scripts', name: 'resume-scripts', range: null }]),
      /run np-x rebuild resume-scripts again/
    );
  });

  it('should keep installing other packages when one fails and resume only the failed one', async () => {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'keep-going-root',
        version: '1.0.0',
        dependencies: { 'resume-scripts': 'file:../resume-scripts', 'keep-going-ok': 'file:../keep-going-ok' },
        scripts: { postinstall: 'node ../resume-scripts/log.js root-postinstall' },
      })
    );
    const installRoot = () => npminstall({ root, env: { RESUME_LOG: logFile, RESUME_FLAG: flagFile } });
    await assert.rejects(installRoot(), /1 package\(s\) failed, run np again/);
    // 失败的包不影响其余包; 有依赖失败时跳过根包脚本
    assert.deepEqual((await readLog()).sort(), ['ok-postinstall', 'postinstall', 'preinstall']);

    await fs.writeFile(flagFile, '');
    await installRoot();
    assert.deepEqual((await readLog()).sort(), [
      'ok-postinstall',
      'postinstall',
      'postinstall',
      'preinstall',
      'root-postinstall',
    ]);
    const okPkg = (await getInstallState(path.join(root, 'node_modules/keep-going-ok'))) || {};
    assert.equal(okPkg.stage, undefined);
  });

  it('should reach the failed dependency through its parent on next install', async () => {
    // file: 依赖按安装根目录解析, root 位于 fixtures 下
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'resume-root',
        version: '1.0.0',
        dependencies: { 'resume-parent': 'file:../resume-parent' },
      })
    );
    const installRoot = () => npminstall({ root, env: { RESUME_LOG: logFile, RESUME_FLAG: flagFile } });
    await assert.rejects(installRoot(), /continue from/);
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall']);

    await fs.writeFile(flagFile, '');
    await installRoot();
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall', 'postinstall']);

    await installRoot();
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall', 'postinstall']);
  });

  it('should skip the optional dependency when a dependency inside it fails', async () => {
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'optional-root',
        version: '1.0.0',
        optionalDependencies: { 'resume-parent': 'file:../resume-parent' },
      })
    );
    // 失败的是可选依赖下的普通子依赖: 与 npm 一样只跳过该可选依赖, 整次安装成功
    await npminstall({ root, env: { RESUME_LOG: logFile, RESUME_FLAG: flagFile } });
    assert.deepEqual(await readLog(), ['preinstall', 'postinstall']);
  });
});
