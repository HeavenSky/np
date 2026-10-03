// np-x rebuild <pkg>: 不下载包, 不改依赖与 package.json, 只重跑 .store 中指定包已安装版本的生命周期脚本

const path = require('node:path');
const fs = require('node:fs/promises');
const chalk = require('chalk');
const utils = require('./utils');
const formatInstallOptions = require('./format_install_options');
const { runLifecycleScripts } = require('./lifecycle_scripts');

module.exports = async options => {
  options = formatInstallOptions(options);
  // 显式重跑时总是输出脚本日志
  options.foregroundScripts = true;
  const targets = [];
  for (const spec of options.rebuildSpecs) {
    const matched = await findInstalled(spec, options);
    if (matched.length === 0) {
      throw new Error(
        `np-x rebuild: ${spec.raw} is not installed in ${path.join(options.root, 'node_modules')}, ` +
          `run np-x rebuild without package names or np to install it`
      );
    }
    targets.push(...matched);
  }

  // 一个包失败不影响其余包, 结束时汇总; 失败的包阶段停在失败的脚本
  for (const { pkg, dir } of targets) {
    const displayName = `${pkg.name}@${pkg.version}`;
    try {
      await runLifecycleScripts(pkg, dir, { name: pkg.name, version: pkg.version }, displayName, options, 'preinstall');
      await utils.setInstallStage(dir);
      options.console.info(chalk.green('rebuilt %s'), displayName);
    } catch (err) {
      options.failures.push({ displayName, error: err, name: pkg.name });
    }
  }
  if (options.failures.length > 0) {
    // 被其他包依赖的子包不会被普通 np 遍历到, 只能再次 np-x rebuild
    const names = [...new Set(options.failures.map(item => item.name))].join(' ');
    throw utils.installFailuresError(options.failures, `run np-x rebuild ${names} again to rerun their scripts`);
  }
  return targets;
};

// 按名称在 .store 中查找全部已安装版本, spec 带版本时按 semver 范围过滤
async function findInstalled(spec, options) {
  // 必须与 utils.getPackageStorePath 的目录规则一致
  const storeRoot = path.join(options.enableWorkspace ? options.workspaceRoot : options.root, 'node_modules/.store');
  const prefix = `${spec.name.replace('/', '+')}@`;
  let entries;
  try {
    entries = await fs.readdir(storeRoot);
  } catch {
    return [];
  }
  const matched = [];
  for (const entry of entries.sort()) {
    if (!entry.startsWith(prefix)) continue;
    const version = entry.slice(prefix.length);
    if (spec.range && !utils.fastSemverSatisfies(version, spec.range)) continue;
    const dir = utils.getPackageStorePath(
      path.join(options.root, 'node_modules'),
      { name: spec.name, version },
      options
    );
    const pkg = await utils.readJSON(path.join(dir, 'package.json'));
    if (pkg.name === spec.name) matched.push({ pkg, dir });
  }
  return matched;
}
