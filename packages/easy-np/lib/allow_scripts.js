// 依赖安装脚本的放行策略: 与 npm 12 相同读取根 package.json 的 allowScripts, 未放行的依赖脚本默认跳过并在结束时列出
const path = require('node:path');
const { readFileSync } = require('node:fs');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const semver = require('semver');
const npConfig = require('./np_config');

const BIN = 'np';

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

function readPackage(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function parseList(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const policy = {};
  for (const name of value.split(/[,\s]+/).filter(Boolean)) policy[name] = true;
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
    if (!nameOnly && (parsed.type === 'tag' || (parsed.type === 'range' && !isExactVersionDisjunction(parsed.fetchSpec)))) {
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

function matches(key, identity) {
  let parsed;
  try {
    parsed = npa(key);
  } catch {
    return false;
  }
  if (identity.git) {
    if (parsed.type !== 'git') return false;
    const target = npa(identity.git);
    if (repoId(parsed) !== repoId(target)) return false;
    return !parsed.gitCommittish || parsed.gitCommittish === target.gitCommittish;
  }
  if (identity.url) {
    return parsed.type === 'remote' && parsed.fetchSpec === identity.url;
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

// 按依赖声明与 package.json 推出比对用的身份; 本地目录与 tarball 文件由用户控制, 不受策略限制, 返回 null
exports.identityOf = (originType, realPkg, originSpec) => {
  if (['file', 'directory'].includes(originType)) return null;
  if (originType === 'git') return { git: realPkg._resolved || originSpec };
  if (originType === 'remote') return { url: originSpec };
  return { name: realPkg.name, version: realPkg.version };
};

// 写入 allowScripts 时使用的键
exports.keyOf = (identity, pin = true) => {
  if (identity.git) return pin ? identity.git : identity.git.replace(/#.*$/, '');
  if (identity.url) return identity.url;
  return pin ? `${identity.name}@${identity.version}` : identity.name;
};

// 依赖的脚本是否可以执行; 不能执行时记入 skipped, 由 report 在安装结束时汇总
exports.allow = (options, identity, { displayName, name, scripts }) => {
  if (!identity) return true;
  const state = exports.ensure(options);
  if (state.allowAll) return true;
  const result = exports.check(state.policy, identity);
  if (result === true) return true;
  state.skipped.push({
    displayName,
    name,
    scripts,
    key: exports.keyOf(identity),
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
  print(
    chalk.yellow('review them, then run: %s-x approve-scripts %s && %s-x rebuild %s'),
    BIN,
    names,
    BIN,
    names
  );
  if (!state.strict) return null;
  const err = new Error(`install scripts of ${pending.length} package(s) are not reviewed in allowScripts`);
  err.code = 'EALLOWSCRIPTS';
  return err;
};
