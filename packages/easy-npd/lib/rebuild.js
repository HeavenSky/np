// npd-x rebuild <pkg>: 不下载包, 不改依赖与 package.json, 只重跑 node_modules 中指定包已安装版本的生命周期脚本
'use strict';

const path = require('path');
const fs = require('fs/promises');
const chalk = require('chalk');
const semver = require('semver');
const utils = require('./utils');
const mirror = require('./mirror');
const formatInstallOptions = require('./format_install_options');
const allowScripts = require('./allow_scripts');

module.exports = async options => {
  options = formatInstallOptions(options);
  const targets = [];
  for (const spec of options.rebuildSpecs) {
    const matched = await findInstalled(spec, options);
    if (matched.length === 0) {
      throw new Error(
        `npd-x rebuild: ${spec.raw} is not installed in ${path.join(options.root, 'node_modules')}, ` +
          `run npd-x rebuild without package names or npd to install it`
      );
    }
    targets.push(...matched);
  }

  // 一个包失败不影响其余包, 结束时汇总; 失败的包阶段停在失败的脚本
  for (const { pkg, dir } of targets) {
    const displayName = `${pkg.name}@${pkg.version}`;
    try {
      // 与安装时一致要在 allowScripts 中放行, 按 package.json 记录的来源比对
      if (!(await allowScripts.allowPackage(pkg, dir, null, null, displayName, options))) continue;
      await rebuildOne(pkg, dir, displayName, options);
    } catch (err) {
      options.failures.push({ displayName, error: err, name: pkg.name });
    }
  }
  const scriptPolicyError = allowScripts.report(options);
  if (scriptPolicyError) options.failures.push({ displayName: 'allowScripts', error: scriptPolicyError });
  if (options.failures.length > 0) {
    // 被其他包依赖的子包不会被普通 npd 遍历到, 只能再次 npd-x rebuild
    const names = [...new Set(options.failures.map(item => item.name))].join(' ');
    throw utils.installFailuresError(options.failures, `run npd-x rebuild ${names} again to rerun their scripts`);
  }
  return targets;
};

async function rebuildOne(pkg, dir, displayName, options) {
  const scripts = pkg.scripts || {};
  // 与安装时一致: 没有 install 脚本但有 binding.gyp 时执行 node-gyp rebuild
  if (!scripts.install && (await utils.exists(path.join(dir, 'binding.gyp')))) {
    scripts.install = 'node-gyp rebuild';
  }
  for (const script of ['preinstall', 'install', 'postinstall']) {
    if (!scripts[script]) continue;
    await utils.setInstallStage(dir, script);
    options.console.warn(
      '%s %s run %j, root: %j',
      chalk.yellow(`scripts.${script}`),
      chalk.gray(displayName),
      scripts[script],
      dir
    );
    try {
      await mirror.runScript(dir, scripts[script], options);
    } catch (err) {
      err.message = `run ${script} error\n${err.message}`;
      throw err;
    }
  }
  await utils.setInstallStage(dir);
  options.console.info(chalk.green('rebuilt %s'), displayName);
}

// 按名称在 node_modules 中查找全部已安装版本, spec 带版本时按 semver 范围过滤
async function findInstalled(spec, options) {
  const storeDir = path.join(options.root, 'node_modules');
  // 必须与 utils.getPackageStorePath 的目录规则一致: _<name>@<version>@<name>
  const prefix = `_${spec.name.replace(/\//g, '_')}@`;
  let entries;
  try {
    entries = await fs.readdir(storeDir);
  } catch {
    return [];
  }
  const matched = [];
  for (const entry of entries.sort()) {
    if (!entry.startsWith(prefix)) continue;
    const version = entry.slice(prefix.length).split('@')[0];
    if (spec.range && !semver.satisfies(version, spec.range)) continue;
    const dir = utils.getPackageStorePath(storeDir, { name: spec.name, version });
    const pkg = await utils.readJSON(path.join(dir, 'package.json'));
    if (pkg.name === spec.name) matched.push({ pkg, dir });
  }
  return matched;
}
