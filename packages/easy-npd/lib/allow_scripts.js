// 依赖安装脚本的放行策略: 与 npm 12 相同读取根 package.json 的 allowScripts, 未放行的依赖脚本默认跳过并在结束时列出
const path = require('node:path');
const { readFileSync } = require('node:fs');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const semver = require('semver');
const npConfig = require('./np_config');
const utils = require('./utils');

const BIN = 'npd';

// 取第一个有配置的来源, 低优先级来源整体忽略: --allow-scripts > 根 package.json 的 allowScripts > ~/.nprc 的 allow-scripts
// global: 全局安装没有项目 package.json, 跳过该来源
exports.load = ({ root, global = false, argv = {}, logger = console }) => {
  const flag = name => {
    for (const value of [argv[name], process.env[`npm_config_${name.replace(/-/g, '_')}`], npConfig.get(name)]) {
      if (value === true || value === 'true' || value === '') return true;
      if (value === false || value === 'false') return false;
    }
    return false;
  };
  let policy = null;
  let source = null;
  const cli = parseList(argv['allow-scripts']);
  if (cli) {
    [policy, source] = [cli, '--allow-scripts'];
  } else if (!global && root) {
    const pkg = readPackage(root);
    if (pkg.allowScripts && typeof pkg.allowScripts === 'object' && Object.keys(pkg.allowScripts).length) {
      [policy, source] = [pkg.allowScripts, 'package.json allowScripts'];
    }
  }
  if (!policy) {
    const rc = parseList(npConfig.get('allow-scripts'));
    if (rc) [policy, source] = [rc, '~/.nprc allow-scripts'];
  }
  return {
    policy: policy && validate(policy, source, logger),
    source,
    allowAll: flag('dangerously-allow-all-scripts'),
    strict: flag('strict-allow-scripts'),
    // 被跳过的依赖: { displayName, name, version, scripts, key, denied }
    skipped: [],
  };
};

// 未经 CLI 入口(API 调用, 测试)时按 options.root 懒加载
exports.ensure = options => {
  if (!options.scriptPolicy) {
    options.scriptPolicy = exports.load({ root: options.root, global: options.global, logger: options.console });
  }
  return options.scriptPolicy;
};

// git 依赖构建子进程使用: 不读克隆仓库的 allowScripts 与 ~/.nprc, 依赖脚本一律不放行
exports.empty = () => ({ policy: null, source: null, allowAll: false, strict: false, skipped: [] });

function readPackage(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

// 重复传入的 --allow-scripts 被 minimist 解析为数组, 各项合并
function parseList(value) {
  const names = []
    .concat(value)
    .filter(item => typeof item === 'string')
    .join(',')
    .split(/[,\s]+/)
    .filter(Boolean);
  if (!names.length) return null;
  const policy = {};
  for (const name of names) policy[name] = true;
  return policy;
}

const isExactVersionDisjunction = spec =>
  spec.split('||').every(part => !!semver.valid(part.trim()) && semver.valid(part.trim()) === part.trim());

// 与 npm 一致: 只接受包名, name@*, 精确版本及其 || 组合, git 与 tarball url; 范围与 dist-tag 告警后忽略
function validate(policy, source, logger) {
  const cleaned = {};
  for (const [key, value] of Object.entries(policy)) {
    let parsed;
    try {
      parsed = npa(key);
    } catch {
      logger.warn(chalk.yellow('%s WARN %s: ignoring unparseable entry "%s"'), BIN, source, key);
      continue;
    }
    const nameOnly = parsed.rawSpec === '' || parsed.rawSpec === '*';
    // 不带版本的包名被 npa 解析为 tag latest, 按名称处理
    if (
      !nameOnly &&
      (parsed.type === 'tag' || (parsed.type === 'range' && !isExactVersionDisjunction(parsed.fetchSpec)))
    ) {
      logger.warn(
        chalk.yellow('%s WARN %s: ignoring "%s", use the package name or exact versions joined by "||"'),
        BIN,
        source,
        key
      );
      continue;
    }
    if (value !== true && value !== false) continue;
    cleaned[key] = value;
  }
  return Object.keys(cleaned).length ? cleaned : null;
}

// identity: { name, version } 来自 registry; { git } 为 git 依赖解析出的地址(含 #sha); { url } 为 tarball url
// 返回 true 放行, false 明确拒绝, null 未审核; 同时命中放行与拒绝时拒绝优先
exports.check = (policy, identity) => {
  if (!policy) return null;
  let allowed = false;
  for (const [key, value] of Object.entries(policy)) {
    if (!matches(key, identity)) continue;
    if (value === false) return false;
    allowed = true;
  }
  return allowed || null;
};

// git 与 url 身份两侧都去掉凭据再比对: 写入的键不带凭据, 旧版本写入的带凭据键也要继续生效
function matches(key, identity) {
  let parsed;
  try {
    parsed = npa(utils.stripUrlAuth(key));
  } catch {
    return false;
  }
  if (identity.git) {
    if (parsed.type !== 'git') return false;
    const target = npa(utils.stripUrlAuth(identity.git));
    if (repoId(parsed) !== repoId(target)) return false;
    return !parsed.gitCommittish || parsed.gitCommittish === target.gitCommittish;
  }
  if (identity.url) {
    return parsed.type === 'remote' && parsed.fetchSpec === utils.stripUrlAuth(identity.url);
  }
  if (!['version', 'range', 'tag'].includes(parsed.type) || parsed.name !== identity.name) return false;
  if (parsed.rawSpec === '' || parsed.rawSpec === '*') return true;
  return parsed.fetchSpec.split('||').some(version => version.trim() === identity.version);
}

function repoId(parsed) {
  if (parsed.hosted) return `${parsed.hosted.domain}/${parsed.hosted.user}/${parsed.hosted.project}`.toLowerCase();
  return String(parsed.fetchSpec)
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .toLowerCase();
}

// 按依赖声明与 package.json 推出比对用的身份; 本地目录与 tarball 文件返回 null, 由调用方按声明者决定是否受信
exports.identityOf = (originType, realPkg, originSpec) => {
  if (['file', 'directory'].includes(originType)) return null;
  if (originType === 'git') return { git: realPkg._resolved || originSpec };
  if (originType === 'remote') return { url: originSpec };
  return { name: realPkg.name, version: realPkg.version };
};

// 写入 allowScripts 时使用的键; package.json 会被提交, git 与 url 键不能带凭据
exports.keyOf = (identity, pin = true) => {
  if (identity.git) {
    const git = utils.stripUrlAuth(identity.git);
    return pin ? git : git.replace(/#.*$/, '');
  }
  if (identity.url) return utils.stripUrlAuth(identity.url);
  return pin ? `${identity.name}@${identity.version}` : identity.name;
};

// 依赖的脚本是否可以执行; 不能执行时记入 skipped, 由 report 在安装结束时汇总
exports.allow = (options, identity, { displayName, name, scripts }) => {
  if (!identity) return true;
  const state = exports.ensure(options);
  if (state.allowAll) return true;
  const result = exports.check(state.policy, identity);
  if (result === true) return true;
  const key = exports.keyOf(identity);
  // git 依赖的构建与它自身的安装脚本各审核一次, 合并成一条
  const existing = state.skipped.find(item => item.key === key && item.name === name);
  if (existing) {
    existing.scripts = [...new Set(existing.scripts.concat(scripts))];
    return false;
  }
  state.skipped.push({
    displayName,
    name,
    scripts,
    key,
    denied: result === false,
  });
  return false;
};

// 打印并清空本次跳过的列表; 严格模式下有未审核的包时返回错误, 由调用方计入失败
exports.report = options => {
  const state = options.scriptPolicy;
  if (!state || state.skipped.length === 0) return null;
  const pending = state.skipped.filter(item => !item.denied);
  state.skipped.length = 0;
  if (pending.length === 0) return null;
  const logger = options.console;
  const print = state.strict ? logger.error : logger.warn;
  print(
    chalk.yellow('%s package(s) have install scripts that are not in allowScripts and were %s:'),
    pending.length,
    state.strict ? 'blocked' : 'skipped'
  );
  for (const item of pending) {
    print(chalk.yellow('  - %s (%s)'), item.displayName, item.scripts.join(', '));
  }
  const names = [...new Set(pending.map(item => item.name))].join(' ');
  print(chalk.yellow('review them, then run: %s-x approve-scripts %s && %s-x rebuild %s'), BIN, names, BIN, names);
  if (!state.strict) return null;
  const err = new Error(`install scripts of ${pending.length} package(s) are not reviewed in allowScripts`);
  err.code = 'EALLOWSCRIPTS';
  return err;
};

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

// 包会执行的安装脚本; 没有 install 但有 binding.gyp 时与 npm 一致隐式执行 node-gyp rebuild
exports.pendingScripts = async (realPkg, dir) => {
  const scripts = realPkg.scripts || {};
  const pending = INSTALL_SCRIPTS.filter(script => scripts[script]);
  if (!pending.includes('install') && (await utils.exists(path.join(dir, 'binding.gyp')))) pending.push('install');
  return pending;
};

// 已安装的包按安装时写入的 _from / _resolved / _scriptsOwner 还原来源; registry 包的名称与版本必须取自 store 目录名, 包内 package.json 由 tarball 作者决定, 可冒充已放行的包
exports.identityOfInstalled = (pkg, dir) => {
  let from = null;
  try {
    from = pkg._from ? npa(pkg._from) : null;
  } catch {
    from = null;
  }
  let type = from && from.type;
  if (!type && typeof pkg._resolved === 'string' && /^git[+:]/.test(pkg._resolved)) type = 'git';
  if (type === 'git' && pkg._resolved) return { git: pkg._resolved };
  if (type === 'remote' && pkg._resolved) return { url: pkg._resolved };
  if (type === 'file' || type === 'directory') return pkg._scriptsOwner ? identityOfKey(pkg._scriptsOwner) : null;
  const stored = dir && utils.parsePackageStorePath(dir);
  if (stored && stored.source) return null;
  if (stored) return stored;
  if (from && from.type === 'version' && from.name) return { name: from.name, version: from.fetchSpec };
  return { name: pkg.name, version: pkg.version };
};

// keyOf 的逆运算
function identityOfKey(key) {
  let parsed;
  try {
    parsed = npa(key);
  } catch {
    return null;
  }
  if (parsed.type === 'git') return { git: key };
  if (parsed.type === 'remote') return { url: key };
  if (parsed.type === 'version' && parsed.name) return { name: parsed.name, version: parsed.fetchSpec };
  return null;
}

// 判断一个依赖包的安装脚本能否执行; 没有脚本时返回 true; identity 为 null 时不受策略限制
exports.allowPackage = async (realPkg, dir, identity, displayName, options) => {
  const pending = await exports.pendingScripts(realPkg, dir);
  if (pending.length === 0) return true;
  return exports.allow(options, identity, { displayName, name: realPkg.name, scripts: pending });
};
