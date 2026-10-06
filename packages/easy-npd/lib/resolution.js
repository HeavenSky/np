'use strict';

const minimatch = require('minimatch');
const semver = require('semver');
const utils = require('./utils');
const chalk = require('chalk');
const { parsePackageName } = require('./alias');
const npa = require('./npa');

// https://github.com/yarnpkg/rfcs/blob/master/implemented/0000-selective-versions-resolutions.md#package-designation
// https://github.com/yarnpkg/yarn/blob/3119382885/src/util/parse-package-path.js#L10
const WRONG_PATTERNS = /\/$|\/{2,}|\*+$/;

// npm overrides 的键: `name` 或 `name@<range>`, scope 包的首个 @ 不是分隔符
function parseOverrideKey(key) {
  const index = key.lastIndexOf('@');
  if (index > 0) return { name: key.slice(0, index), keySpec: key.slice(index + 1) || '*' };
  return { name: key, keySpec: '*' };
}

// 把 npm overrides 展开成规则: parents 依次出现在祖先链中(可隔代)且末端包名与 keySpec 匹配时改用 version
// https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides
function parseOverrides(overrides, overridesPkg) {
  const rules = [];
  const resolveRef = value => {
    if (!value.startsWith('$')) return value;
    const name = value.slice(1);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const spec = overridesPkg[field] && overridesPkg[field][name];
      if (spec) return spec;
    }
    throw new Error(`[overrides] unable to resolve reference ${value}, ${name} must be a direct dependency`);
  };
  const walk = (obj, parents) => {
    for (const key in obj) {
      if (key === '.') continue;
      const { name, keySpec } = parseOverrideKey(key);
      const value = obj[key];
      if (typeof value === 'string') {
        rules.push({ parents, name, keySpec, version: resolveRef(value) });
      } else if (value && typeof value === 'object') {
        if (typeof value['.'] === 'string') {
          rules.push({ parents, name, keySpec, version: resolveRef(value['.']) });
        }
        walk(value, parents.concat({ name, keySpec }));
      } else {
        throw new Error(`[overrides] override ${key} must be a string or an object`);
      }
    }
  };
  walk(overrides, []);
  // 嵌套越深的规则越具体, 优先于外层规则
  return rules.sort((a, b) => b.parents.length - a.parents.length);
}

function specIntersects(spec, keySpec) {
  if (keySpec === '*') return true;
  try {
    return !!semver.validRange(spec, true) && semver.intersects(spec, keySpec, { loose: true });
  } catch {
    return false;
  }
}

function parentsMatch(parents, ancestors) {
  let index = 0;
  for (const ancestor of ancestors) {
    const parent = parents[index];
    if (!parent) break;
    if (
      ancestor.name === parent.name &&
      (parent.keySpec === '*' || (ancestor.version && semver.satisfies(ancestor.version, parent.keySpec, true)))
    ) {
      index++;
    }
  }
  return index === parents.length;
}

// createResolution
// overridesPkg 是读取 npm overrides 的 package.json, workspace 安装时为 workspace 根
module.exports = (pkg, options, overridesPkg = pkg) => {
  const overrideRules = parseOverrides((overridesPkg && overridesPkg.overrides) || {}, overridesPkg || {});
  const resolutions = (pkg && pkg.resolutions) || {};
  const resolutionMap = new Map();

  // parse resolutions, generate resolutionMap:
  // {
  //   debug: [
  //     "koa/accept", "1.0.0",
  //     "send": "2.0.0"
  //   ],
  //   less: [
  //     "**", "^1"
  //   ],
  //   vary: [
  //     "@koa/cors", "1.0.0"
  //   ]
  // }
  for (const path in resolutions) {
    const sections = path.split('/');
    let scope = '';
    const packages = [];
    // 1. check package name
    if (WRONG_PATTERNS.test(path)) {
      throw new Error(`[resolutions] resolution package ${path} format error`);
    }
    // 2. process package with scope like `@koa/cors`
    for (let section of sections) {
      if (section.startsWith('@') && !scope) {
        scope = section;
        continue;
      }
      if (scope) {
        section = `${scope}/${section}`;
        scope = '';
      }
      packages.push(section);
    }
    // debug => **/debug
    if (packages.length === 1) packages.unshift('**');
    const endpoint = packages.pop();
    const version = resolutions[path];

    if (!resolutionMap.has(endpoint)) resolutionMap.set(endpoint, []);
    resolutionMap.get(endpoint).push([packages.join('/'), version]);
  }

  // overridden: 版本由根项目的 overrides / resolutions 指定, 本地路径按项目根解析且脚本按根项目的本地依赖处理
  const replaceVersion = (pkg, version, nested) => {
    // alias(npm:lodash@^1) support
    const [aliasPackageName, realPackageName] = parsePackageName(`${pkg.name}@${version}`, nested);

    if (aliasPackageName) {
      const { name, fetchSpec } = npa(realPackageName, { nested });

      return Object.assign({}, pkg, {
        alias: aliasPackageName,
        version: fetchSpec,
        name,
        overridden: true,
      });
    }

    return Object.assign({}, pkg, { version, overridden: true });
  };

  return (pkg, ancestors, nested) => {
    // only work for nested dependencies
    if (!ancestors.length) return pkg;

    for (const rule of overrideRules) {
      if (rule.name !== pkg.name || !specIntersects(pkg.version, rule.keySpec)) continue;
      if (!parentsMatch(rule.parents, ancestors)) continue;
      if (rule.version === pkg.version) return pkg;
      options.pendingMessages.push([
        'warn',
        '%s %s overridden by %s',
        chalk.yellow('overrides'),
        chalk.gray(utils.getDisplayName(pkg, ancestors)),
        chalk.magenta(`${pkg.name}@${rule.version}`),
      ]);
      return replaceVersion(pkg, rule.version, nested);
    }

    // check pkg.name first to reduce calculate
    const resolutions = resolutionMap.get(pkg.name);
    if (!resolutions) return pkg;

    const ancestorPath = ancestors.map(ancestor => ancestor.name).join('/');
    for (const resolution of resolutions) {
      const path = resolution[0];
      const version = resolution[1];
      if (minimatch(ancestorPath, path)) {
        options.pendingMessages.push([
          'warn',
          '%s %s overridden by %s',
          chalk.yellow('resolutions'),
          chalk.gray(utils.getDisplayName(pkg, ancestors)),
          chalk.magenta(`${path}/${pkg.name}@${version}`),
        ]);
        return replaceVersion(pkg, version, nested);
      }
    }

    return pkg;
  };
};
