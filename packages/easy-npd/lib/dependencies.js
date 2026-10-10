'use strict';

const npa = require('./npa');
const { parsePackageName } = require('./alias');

// 选取根项目要安装的字段时的优先顺序: 同名依赖取先出现的字段, 与 npm 一致 optionalDependencies 覆盖 dependencies
const FIELD_ORDER = ['optionalDependencies', 'dependencies', 'peerDependencies'];

// rootFields: 命令行 --only / --include / --omit 选出的根项目字段, 只对根项目生效; 不传时按 npm 默认
module.exports = function dependencies(pkg, options, nested, rootFields = null) {
  if (rootFields) return select(pkg, nested, rootFields);
  const all = {};
  const prod = {};
  const optionalDependencies = pkg.optionalDependencies || {};
  const dependencies = pkg.dependencies || {};
  const devDependencies = pkg.devDependencies || {};

  for (const name in dependencies) {
    all[name] = dependencies[name];
    prod[name] = dependencies[name];
  }
  // follow npm, optionalDependencies will rewrite dependencies
  for (const name in optionalDependencies) {
    if (options.ignoreOptionalDependencies) {
      delete all[name];
      delete prod[name];
    } else {
      all[name] = optionalDependencies[name];
      prod[name] = optionalDependencies[name];
    }
  }
  for (const name in devDependencies) {
    if (!all.hasOwnProperty(name)) {
      all[name] = devDependencies[name];
    }
  }

  return {
    get allMap() {
      return all;
    },

    get all() {
      return mergeOptional(all, optionalDependencies, nested);
    },

    get prodMap() {
      return prod;
    },

    get prod() {
      return mergeOptional(prod, optionalDependencies, nested);
    },
  };
};

// 按字段选出的依赖; all 与 prod 相同, 安装与根依赖判断都只看选中的字段
function select(pkg, nested, rootFields) {
  const selected = {};
  const fields = [
    ...FIELD_ORDER.filter(field => rootFields.includes(field)),
    ...rootFields.filter(field => !FIELD_ORDER.includes(field) && field !== 'devDependencies'),
    ...(rootFields.includes('devDependencies') ? ['devDependencies'] : []),
  ];
  for (const field of fields) {
    const deps = pkg[field] || {};
    for (const name in deps) {
      if (!selected.hasOwnProperty(name)) selected[name] = deps[name];
    }
  }
  const optional = rootFields.includes('optionalDependencies') ? pkg.optionalDependencies || {} : {};
  const list = () => mergeOptional(selected, optional, nested);
  return {
    get allMap() {
      return selected;
    },
    get all() {
      return list();
    },
    get prodMap() {
      return selected;
    },
    get prod() {
      return list();
    },
  };
}

function mergeOptional(deps, optional, nested) {
  const results = [];

  for (const name in deps) {
    const version = deps[name];
    const pkg = {
      name,
      version,
      optional: optional.hasOwnProperty(name),
    };

    const raw = `${name}@${version}`;
    nested.update([raw]);

    const [aliasPackageName, realPackageName] = parsePackageName(raw, nested);

    if (aliasPackageName) {
      const { name, fetchSpec } = npa(realPackageName, { nested });
      pkg.alias = aliasPackageName;
      pkg.name = name;
      pkg.version = fetchSpec;
    }

    results.push(pkg);
  }
  return results;
}
