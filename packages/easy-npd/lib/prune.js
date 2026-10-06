// npd-x prune: 从 node_modules 顶层链接出发遍历依赖链接, 删除不再被引用的 _<name>@<version>@<name> 目录
'use strict';

const path = require('path');
const fs = require('fs/promises');
const utils = require('./utils');
const installState = require('./install_state');

// 包版本目录: _name@version@name, scope 包为 _@scope_name@version@@scope, 包本体在其下的 name 子目录
const isStoreEntry = name => name.startsWith('_') && name.includes('@');

module.exports = async ({ root, dryRun = false }) => {
  // 链接目标都按 realpath 比较, node_modules 或 --root 经过符号链接时不取 realpath 会把所有包都判为不可达
  const linkedStoreDir = path.join(root, 'node_modules');
  const storeDir = await fs.realpath(linkedStoreDir).catch(() => linkedStoreDir);
  let entries;
  try {
    entries = (await fs.readdir(storeDir)).filter(isStoreEntry);
  } catch {
    return { removed: [], kept: 0 };
  }

  const reachable = new Set();
  const visitedDirs = new Set();
  // 扫描一个 node_modules 目录: 链接到包版本目录的条目记为可达并继续扫描该包的 node_modules
  const scan = async (dir, isTopLevel) => {
    if (visitedDirs.has(dir)) return;
    visitedDirs.add(dir);
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('.') || (isTopLevel && isStoreEntry(name))) continue;
      const full = path.join(dir, name);
      if (name.startsWith('@')) {
        await scan(full, false);
        continue;
      }
      const stat = await fs.lstat(full).catch(() => null);
      if (!stat) continue;
      if (!stat.isSymbolicLink()) {
        if (stat.isDirectory()) await scan(path.join(full, 'node_modules'), false);
        continue;
      }
      const target = await fs.realpath(full).catch(() => null);
      if (!target) continue;
      const relative = path.relative(storeDir, target);
      const entry = relative.split(path.sep)[0];
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && isStoreEntry(entry)) {
        reachable.add(entry);
      }
      // 包本体可能再链接自己的依赖; 本地目录依赖链接到项目外, 它的 node_modules 同样可能链接进来
      await scan(path.join(target, 'node_modules'), false);
    }
  };
  await scan(storeDir, true);

  const removed = entries.filter(entry => !reachable.has(entry)).sort();
  if (!dryRun) {
    await installState.removeEntries(storeDir, entry => removed.includes(entry) || !entries.includes(entry));
    for (const entry of removed) await utils.rimraf(path.join(storeDir, entry));
  }
  return { removed, kept: entries.length - removed.length };
};
