const semver = require('semver');
const npa = require('./npa');
const { parsePackageName } = require('./alias');

const WORKSPACE_PROTOCOL = 'workspace:';

// workspace: 协议只能链接本地 workspace, 转成等价 range 交给 npa 解析, 并记下名字供安装时校验必须存在同名 workspace
function normalizeWorkspaceProtocol(deps, workspaceNames) {
  const result = {};
  for (const name in deps) {
    const spec = deps[name];
    if (typeof spec === 'string' && spec.startsWith(WORKSPACE_PROTOCOL)) {
      const range = spec.slice(WORKSPACE_PROTOCOL.length);
      result[name] = ['', '*', '^', '~'].includes(range) || !semver.validRange(range) ? '*' : range;
      workspaceNames.add(name);
    } else {
      result[name] = spec;
    }
  }
  return result;
}

module.exports = function dependencies(pkg, options, nested) {
  const all = {};
  const prod = {};
  const client = {};
  const workspaceNames = new Set();
  const optionalDependencies = normalizeWorkspaceProtocol(pkg.optionalDependencies || {}, workspaceNames);
  const dependencies = normalizeWorkspaceProtocol(pkg.dependencies || {}, workspaceNames);
  const devDependencies = normalizeWorkspaceProtocol(pkg.devDependencies || {}, workspaceNames);
  const clientDependencies = normalizeWorkspaceProtocol(pkg.clientDependencies || {}, workspaceNames);
  const buildDependencies = normalizeWorkspaceProtocol(pkg.buildDependencies || {}, workspaceNames);
  const isomorphicDependencies = normalizeWorkspaceProtocol(pkg.isomorphicDependencies || {}, workspaceNames);

  checkDumplicate(pkg);

  for (const name in dependencies) {
    all[name] = dependencies[name];
    prod[name] = dependencies[name];
  }
  for (const name in clientDependencies) {
    all[name] = clientDependencies[name];
    client[name] = clientDependencies[name];
  }
  for (const name in buildDependencies) {
    all[name] = buildDependencies[name];
    client[name] = buildDependencies[name];
  }
  for (const name in isomorphicDependencies) {
    all[name] = isomorphicDependencies[name];
    prod[name] = isomorphicDependencies[name];
    client[name] = isomorphicDependencies[name];
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
      return mergeOptional(all, optionalDependencies, nested, workspaceNames);
    },

    get prodMap() {
      return prod;
    },

    get prod() {
      return mergeOptional(prod, optionalDependencies, nested, workspaceNames);
    },

    get clientMap() {
      return client;
    },

    get client() {
      return mergeOptional(client, optionalDependencies, nested, workspaceNames);
    },
  };
};

function mergeOptional(deps, optional, nested, workspaceNames) {
  const results = [];

  for (const name in deps) {
    const version = deps[name];
    const pkg = {
      name,
      version,
      optional: optional.hasOwnProperty(name),
    };
    if (workspaceNames.has(name)) pkg.workspaceProtocol = true;

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

function checkDumplicate(pkg) {
  const all = new Map();

  function push(scope) {
    const dependencies = pkg[scope] || {};
    for (const name in dependencies) {
      if (!all.has(name)) all.set(name, []);
      all.get(name).push(scope);
    }
  }

  push('dependencies');
  push('clientDependencies');
  push('isomorphicDependencies');

  const duplicates = [];
  for (const dep of all) {
    if (dep[1].length > 1) duplicates.push(dep);
  }

  if (duplicates.length) {
    const detail = duplicates.map(dep => `${dep[0]} defined multiple times in ${dep[1].join(',')}`).join('\n');
    throw new Error(`duplicate dependencies error, put isomorphic dependency into isomorphicDependencies:\n${detail}`);
  }
}
