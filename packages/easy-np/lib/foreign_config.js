// 兼容读取的 npm 与 pnpm 配置: .npmrc 与 npm_config_* 环境变量(经 rc), 项目根的 pnpm-workspace.yaml 与 package.json 的 pnpm 字段
const path = require('node:path');
const { readFileSync } = require('node:fs');
const chalk = require('chalk');
const yaml = require('js-yaml');
const globalConfig = require('./config');

// rc('npm') 只去掉环境变量的 npm_ 前缀, npm_config_shamefully_hoist 以 config_shamefully_hoist 出现; 环境变量优先于 .npmrc
function npmrcValue(key) {
  const fromEnv = globalConfig.npmrc[`config_${key.replace(/-/g, '_')}`];
  return fromEnv !== undefined ? fromEnv : globalConfig.npmrc[key];
}

exports.toBool = value => {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
};

exports.npmrcFlag = key => exports.toBool(npmrcValue(key));

// .npmrc 中的 registry 与 @scope:registry, 优先级低于 --registry, npm_registry 与 ~/.nprc
exports.registry = (key = 'registry') => {
  const value = npmrcValue(key);
  return typeof value === 'string' && value ? value : undefined;
};

// 读取失败的 pnpm-workspace.yaml 不能静默当作空配置, 否则其中的 onlyBuiltDependencies 等会被忽略而退回默认行为
exports.pnpm = (root, logger = console) => {
  let fromPkg = {};
  try {
    fromPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).pnpm || {};
  } catch {
    // package.json 不存在或无法解析时由安装流程报告
  }
  let fromYaml = {};
  const file = path.join(root, 'pnpm-workspace.yaml');
  try {
    fromYaml = yaml.load(readFileSync(file, 'utf8')) || {};
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn(chalk.yellow('np WARN ignoring %s: %s'), file, err.message);
  }
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  // 与 pnpm 10 一致, pnpm-workspace.yaml 的设置优先于 package.json 的 pnpm 字段
  return { ...(isObject(fromPkg) ? fromPkg : {}), ...(isObject(fromYaml) ? fromYaml : {}) };
};

const names = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : []);

// pnpm-workspace.yaml 的 packages
exports.pnpmWorkspaces = root => names(exports.pnpm(root).packages);

// pnpm 的依赖构建策略转成 allowScripts 形式; neverBuiltDependencies 表示未列出的依赖都放行, 由 allowUnreviewed 表达
exports.pnpmScriptPolicy = settings => {
  const policy = {};
  for (const name of names(settings.onlyBuiltDependencies)) policy[name] = true;
  const never = names(settings.neverBuiltDependencies);
  for (const name of [...never, ...names(settings.ignoredBuiltDependencies)]) policy[name] = false;
  if (settings.allowBuilds && typeof settings.allowBuilds === 'object') {
    for (const [name, value] of Object.entries(settings.allowBuilds)) {
      if (typeof value === 'boolean') policy[name] = value;
    }
  }
  // pnpm 在设置了 onlyBuiltDependencies 时忽略 neverBuiltDependencies 的放行含义
  const allowUnreviewed = never.length > 0 && names(settings.onlyBuiltDependencies).length === 0;
  return { policy: Object.keys(policy).length ? policy : null, allowUnreviewed };
};

// 与 @pnpm/matcher 一致: 整名匹配, * 匹配任意字符, ! 开头为排除; 只有排除项时匹配其余全部
exports.globsToRegExp = globs => {
  const escape = glob => glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const include = globs.filter(glob => !glob.startsWith('!')).map(escape);
  const exclude = globs.filter(glob => glob.startsWith('!')).map(glob => escape(glob.slice(1)));
  if (include.length === 0 && exclude.length === 0) return null;
  const head = exclude.length ? `(?!(?:${exclude.join('|')})$)` : '';
  return `^${head}(?:${include.length ? include.join('|') : '.*'})$`;
};

// 提升到 <root>/node_modules 的包名正则: shamefully-hoist 与 hoisted 布局提升全部, 否则取 public-hoist-pattern; 都未配置时返回 null
exports.publicHoistPattern = settings => {
  const shamefully = exports.toBool(settings.shamefullyHoist) ?? exports.npmrcFlag('shamefully-hoist');
  if (shamefully) return '.*';
  // pnpm 的 nodeLinker 与 npm 的 install-strategy 为 hoisted 时同样全部提升到根目录
  const linker = settings.nodeLinker ?? npmrcValue('node-linker');
  if (linker === 'hoisted' || npmrcValue('install-strategy') === 'hoisted') return '.*';
  let globs = settings.publicHoistPattern;
  if (globs === undefined) globs = npmrcValue('public-hoist-pattern');
  if (typeof globs === 'string') globs = [globs];
  return Array.isArray(globs) ? exports.globsToRegExp(names(globs)) : null;
};

// pnpm 的 lockfile 与 npm 的 package-lock 设为 false 时不读写 np-lock.json; 返回 undefined 表示未配置
exports.lockfile = settings =>
  exports.toBool(settings.lockfile) ?? exports.npmrcFlag('lockfile') ?? exports.npmrcFlag('package-lock');
