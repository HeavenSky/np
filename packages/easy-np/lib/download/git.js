const path = require('node:path');
const { randomUUID } = require('node:crypto');
const chalk = require('chalk');
const pacote = require('pacote');
const Arborist = require('@npmcli/arborist');
const utils = require('../utils');

module.exports = async (pkg, options) => {
  if (options.offline) {
    throw new Error(`Can't install ${pkg.raw} on offline mode: git packages are always fetched from the network`);
  }
  const { name, raw, displayName } = pkg;

  options.gitPackages++;
  options.console.warn(
    chalk.yellow(`[${displayName}] install ${name || ''} from git ${raw}, may be very slow, please keep patience`)
  );
  // 外层 npm/npx 会把 allow-scripts 导出为该环境变量, pacote 为 git 依赖执行 npm install 时继承它会被 npm 12 以 EALLOWSCRIPTS 拒绝;
  // 删除后子进程 npm 改从 .npmrc 读取同一配置
  delete process.env.npm_config_allow_scripts;
  const cloneDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(cloneDir);
  try {
    const resolveResult = await pacote.extract(raw, cloneDir, {
      Arborist,
    });
    const resolved = resolveResult.resolved;
    await utils.addMetaToJSONFile(path.join(cloneDir, 'package.json'), {
      _from: raw,
      _resolved: resolved,
    });
    const res = await utils.copyInstall(cloneDir, options);
    if (name && name !== res.package.name) {
      options.console.warn(
        chalk.yellow(`[${displayName}] Package name unmatched: expected ${name} but found ${res.package.name}`)
      );
      res.package.name = name;
    }
    // record package name
    options.remoteNames[raw] = res.package.name;
    return res;
  } catch (err) {
    // pacote 的 spawn 错误只在 stderr 里带真实原因(例如子进程 npm 的错误码), 附上末尾便于定位
    const stderr = err.stderr ? `\n${String(err.stderr).trim().split('\n').slice(-5).join('\n')}` : '';
    throw new Error(`[${displayName}] ${err.message}${stderr}`, { cause: err });
  } finally {
    // clean up
    try {
      await utils.rimraf(cloneDir);
    } catch (err) {
      options.console.warn(chalk.yellow(`rmdir git clone dir: ${cloneDir} error: ${err}, ignore it`));
    }
  }
};
