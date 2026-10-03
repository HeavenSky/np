const chalk = require('chalk');
const path = require('path');
const utils = require('./utils');
const mirror = require('./mirror');

module.exports = postinstall;

// @see https://docs.npmjs.com/misc/scripts
// npd will collect all install & postinstall scripts,
// and run these scripts until all dependencies installed
// node-gyp rebuild don't dependent on other packages, so we can run it immediately
// stage: 依赖包上次停在的阶段, 跳过已完成的脚本; 根包不传, 不写标记
async function postinstall(pkg, root, optional, displayName, options, stage) {
  const scripts = pkg.scripts || {};

  // https://docs.npmjs.com/misc/scripts#default-values
  // "install": "node-gyp rebuild"
  // If there is a binding.gyp file in the root of your package,
  // npm will default the install command to compile using node-gyp.
  if (
    !scripts.install &&
    utils.shouldRunStage(stage, 'install') &&
    (await utils.exists(path.join(root, 'binding.gyp')))
  ) {
    options.console.warn(
      '[npd:runscript] %s found binding.gyp file, auto run "node-gyp rebuild", root: %j',
      chalk.gray(displayName),
      root
    );
    const cmd = 'node-gyp rebuild';
    if (stage) await utils.setInstallStage(root, 'install');
    try {
      await mirror.runScript(root, cmd, options);
    } catch (err) {
      options.console.warn(
        '[npd:runscript:error] %s has binding.gyp file, run %j error: %s',
        chalk.red(displayName),
        cmd,
        err
      );
      throw err;
    }
    if (stage) await utils.setInstallStage(root, 'postinstall');
  }

  if ((scripts.install || scripts.postinstall) && utils.shouldRunStage(stage, 'postinstall')) {
    if (options.postInstallTasks.some(task => task.root === root)) {
      return;
    }
    options.postInstallTasks.push({
      pkg,
      root,
      optional,
      displayName,
      stage,
    });
  }
}
