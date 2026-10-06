'use strict';

const assert = require('node:assert');
const dependencies = require('./dependencies');

const NODE_MODULES_DIR = 'node_modules/';

/**
 * The lockfileConverter converts a npm package-lockfile.json to np .dependencies-tree.json.
 * Only lockfileVersion >= 2 is supported.
 * Workspace packages (`link: true` entries) are skipped, np links the local workspaces itself.
 * @param {Object} lockfile package-lock.json data
 * @param {Object} options installation options
 * @param {Nested} nested Nested
 */
exports.lockfileConverter = function lockfileConverter(lockfile, options, nested) {
  assert(lockfile.lockfileVersion >= 2, 'Only lockfileVersion >=2 is supported.');

  const tree = {};

  const packages = lockfile.packages;
  for (const pkgPath in packages) {
    /**
     * the lockfile contains all the deps so there's no need to be deps type sensitive.
     */
    const deps = dependencies(packages[pkgPath], options, nested);
    const allMap = deps.allMap;
    for (const key in allMap) {
      const mani = exports.nodeModulesPath(pkgPath, key, packages);
      if (!mani || mani.link) continue;
      const dist = {
        integrity: mani.integrity,
        tarball: mani.resolved,
      };
      // we need to remove the integrity and resolved field from the mani
      // but the mani should be left intact
      const maniClone = Object.assign({}, mani);
      delete maniClone.integrity;
      delete maniClone.resolved;
      // 依赖树按 name@spec 建键, 不区分位置: 同一声明在不同位置锁定了不同版本时保留先遇到的(更靠近根目录), 交给调用方告警
      const treeKey = `${key}@${allMap[key]}`;
      if (tree[treeKey]) {
        if (tree[treeKey].version !== mani.version && options.onConflict) {
          options.onConflict(treeKey, tree[treeKey].version, mani.version);
        }
        continue;
      }
      tree[treeKey] = {
        name: key,
        ...maniClone,
        dist,
        _id: `${key}@${mani.version}`,
      };
    }
  }

  return tree;
};

/**
 * find the matched version of current semver based on nodejs modules resolution algorithm
 * we need check the current directory and ancestors directories to find the matched version of lodash.has
 * e.g.
 *  "": {
 *    "dependencies": {
 *      "lodash.has": "4",
 *      "a": "latest"
 *    },
 *  'node_modules/lodash.has': {
 *    "version": '4.4.0'
 *  },
 *  'node_modules/a': {
 *    'dependencies': {
 *       "lodash.has": "3"
 *    }
 *  },
 *  'node_modules/a/node_modules/lodash.has': {
 *    "version": "3.0.0"
 *  },
 * }
 *
 * the root lodash.has@4 should matches node_modules/lodash.has
 *
 * @param {string} currentPath the current pakcage.json path
 * @param {string} name the dependency name of current package.json
 * @param {Object} packages the lockfile packages
 */
exports.nodeModulesPath = function nodeModulesPath(currentPath, name, packages) {
  // 从当前目录逐级向上查找 <dir>/node_modules/<name>; workspace 目录(例如 packages/a)的上一级是根目录
  let base = currentPath;
  for (;;) {
    const dir = base ? `${base}/${NODE_MODULES_DIR}${name}` : `${NODE_MODULES_DIR}${name}`;
    if (packages[dir]) return packages[dir];
    if (!base) return undefined;
    const index = base.lastIndexOf(NODE_MODULES_DIR);
    base = index > 0 ? base.slice(0, index - 1) : '';
  }
};
