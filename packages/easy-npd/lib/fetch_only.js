// npd-fetch: 只下载, 校验并解压指定的包, 链接到 node_modules/<name>; 不安装依赖, 不执行脚本, 不链接 bin
'use strict';

const path = require('path');
const chalk = require('chalk');
const pMap = require('p-map');
const utils = require('./utils');
const npa = require('./npa');
const link = require('./link');
const download = require('./download');
const formatInstallOptions = require('./format_install_options');
const Context = require('./context');

module.exports = async (options, context = new Context()) => {
  options = formatInstallOptions(options);
  const fetched = await pMap(options.pkgs, pkg => fetchOne(pkg, options, context), 10);
  for (const { realPkg, dir } of fetched) {
    options.console.info(
      '%s %s %s',
      chalk.green('+'),
      chalk.yellow(`${realPkg.name}@${realPkg.version}`),
      chalk.gray(dir.replace(options.root, '.'))
    );
  }
  return fetched;
};

async function fetchOne(pkg, options, context) {
  const version = pkg.version || '*';
  const p = npa(pkg.name ? `${pkg.name}@${version}` : version, { where: options.root, nested: context.nested });
  if (p.type === 'git') {
    throw new Error(`npd-fetch does not support git package "${p.raw}": fetching it runs its prepare script`);
  }
  const info = await download(p, options);
  const realPkg = info.package;
  // 撤掉完成标记, 否则之后的完整 npd 会把它当作依赖已装好而跳过
  if (!info.exists) await utils.unsetInstallDone(info.dir);
  await link(options.targetDir, realPkg, info.dir, pkg.alias);
  return { realPkg, dir: path.join(options.targetDir, 'node_modules', pkg.alias || realPkg.name) };
}
