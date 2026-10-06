/**
 * impl npm install [pkg1, pkg2, ...]
 */

const debug = require('node:util').debuglog('np:local_install');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { writeFileSync } = require('node:fs');
const util = require('node:util');
const chalk = require('chalk');
const ms = require('ms');
const pMap = require('p-map');
const semver = require('semver');
const bytes = require('bytes');
const dayjs = require('dayjs');
const utils = require('./utils');
const installPackage = require('./install_package');
const dependencies = require('./dependencies');
const createResolution = require('./resolution');
const formatInstallOptions = require('./format_install_options');
const Context = require('./context');
const { runLifecycleScripts } = require('./lifecycle_scripts');
const allowScripts = require('./allow_scripts');

/**
 * npm install
 * @param {Object} options - install options
 *  - {String} root - npm install root dir
 *  - {String} [registry] - npm registry url, default is `https://registry.npmjs.com`
 *  - {String} [targetDir] - node_modules target dir, default is ${root}.
 *  - {String} [storeDir] - npm modules store dir, default is `${targetDir}/node_modules`
 *  - {Number} [timeout] - npm registry request timeout, default is 60000 ms
 *  - {Number} [streamingTimeout] - download tar.gz stream timeout, default is 120000 ms
 *  - {Console} [console] - console logger instance, default is `console`
 *  - {Array<Object>} [pkgs] - optional packages to install, default is `[]`
 *  - {Boolean} [production] - production mode install, default is `false`
 *  - {Object} [env] - postinstall and preinstall scripts custom env.
 *  - {String} [cacheDir] - tarball cache store dir, default is `$HOME/.np_tarball`.
 *  	if `production` mode enable, `cacheDir` will be disable.
 *  - {Object} [binaryMirrors] - binary mirror config, default is `{}`
 *  - {Boolean} [ignoreScripts] - ignore pre / post install scripts, default is `false`
 *  - {Array} [forbiddenLicenses] - forbid installing packages that use these licenses
 *  - {Boolean} [trace] - show memory and CPU usage traces of the installation
 *  - {Boolean} [flatten] - flatten dependencies by matching ancestors' dependencies
 *  - {Boolean} [offline] - offline mode, default is `false`
 *  - {Boolean} [rebuild] - install every installed package again from its first stage and rerun its scripts, default is `false`
 * @param {Object} context - install context
 */
module.exports = async (options, context = new Context()) => {
  options = formatInstallOptions(options);
  if (options.spinner) options.spinner.start();
  let traceTimer;
  let showTrace;
  if (options.trace) {
    const startTime = Date.now();
    let cpuUsage = process.cpuUsage && process.cpuUsage();
    showTrace = () => {
      cpuUsage = process.cpuUsage && process.cpuUsage(cpuUsage);
      const memoryUsage = process.memoryUsage();
      const loads = os
        .loadavg()
        .map(v => Math.round(v * 10) / 10 + '')
        .join(', ');
      if (cpuUsage) {
        options.console.warn(
          '[trace] %s 🏊  memory usage, rss: %s, heapTotal: %s, heapUsed: %s, external: %s; 💻  os free: %s, os load: %s; 🏃  cpu usage, user: %s, system: %s',
          ms(Date.now() - startTime),
          bytes(memoryUsage.rss),
          bytes(memoryUsage.heapTotal),
          bytes(memoryUsage.heapUsed),
          bytes(memoryUsage.external || 0),
          bytes(os.freemem()),
          loads,
          Math.floor(cpuUsage.user / 1000 / 1000),
          Math.floor(cpuUsage.system / 1000 / 1000)
        );
      } else {
        options.console.warn(
          '[trace] %s 🏊  memory usage, rss: %s, heapTotal: %s, heapUsed: %s, external: %s; 💻  os free: %s, os load: %s',
          ms(Date.now() - startTime),
          bytes(memoryUsage.rss),
          bytes(memoryUsage.heapTotal),
          bytes(memoryUsage.heapUsed),
          bytes(memoryUsage.external || 0),
          bytes(os.freemem()),
          loads
        );
      }
    };
    traceTimer = setInterval(showTrace, 1000);
  }

  try {
    await _install(options, context);
  } catch (err) {
    // 失败汇总由调用方输出, 这里只给一行结论
    const message =
      err.code === utils.INSTALL_FAILURES_CODE
        ? `Install finished with ${err.failures.length} failed package(s)`
        : `Install failed! ${err}`;
    if (options.spinner) {
      options.spinner.fail(message);
    } else {
      options.console.error(message);
    }
    throw err;
  } finally {
    if (traceTimer) {
      clearInterval(traceTimer);
      showTrace();
    }
  }
};

async function _install(options, context) {
  const rootPkgFile = path.join(options.root, 'package.json');
  const rootPkg = await utils.readJSON(rootPkgFile);
  const displayName = `${rootPkg.name}@${rootPkg.version}`;
  let pkgs = options.pkgs;
  const rootPkgDependencies = dependencies(rootPkg, options, context.nested);
  options.rootPkgDependencies = rootPkgDependencies;
  // 与 npm 一致, workspace 只认 workspace 根 package.json 的 overrides
  const overridesPkg =
    options.enableWorkspace && options.isWorkspacePackage
      ? await utils.readJSON(path.join(options.workspaceRoot, 'package.json'))
      : rootPkg;
  options.resolution = createResolution(rootPkg, options, overridesPkg);
  // peer 自动安装要知道 workspace 根已声明哪些依赖, 在安装子依赖之前加载
  if (options.enableWorkspace && options.isWorkspacePackage) await getWorkspaceRootDepNames(options, context);
  // 补记锁文件子树时套用同样的改写规则, 但不重复打印 overrides 告警
  options.lockResolution = createResolution(rootPkg, { pendingMessages: [] }, overridesPkg);
  if (pkgs.length === 0) {
    if (options.client) {
      pkgs = rootPkgDependencies.client;
    } else if (options.production) {
      pkgs = rootPkgDependencies.prod;
    } else {
      pkgs = rootPkgDependencies.all;
    }
    debug(
      `about to locally install pkgs (production: ${options.production}, client: ${options.client}): ${JSON.stringify(pkgs, null, 2)}`
    );
  } else {
    debug('pkgs: %o', pkgs);
    // try to fix no version package from rootPkgDependencies
    const allDeps = rootPkgDependencies.allMap;
    for (const childPkg of pkgs) {
      if (!childPkg.version && allDeps[childPkg.name]) {
        childPkg.version = allDeps[childPkg.name];
        debug('auto fill version: %j', childPkg);
      }
    }
  }

  context.nested.update(
    pkgs.map(pkg => `${pkg.name}@${pkg.version}`),
    rootPkg.name && rootPkg.version ? displayName : 'root'
  );
  const nodeModulesDir = path.join(options.targetDir, 'node_modules');
  await utils.mkdirp(nodeModulesDir);
  const rootPkgsMap = new Map();
  const mapper = async childPkg => {
    childPkg.name = childPkg.name || '';
    rootPkgsMap.set(childPkg.name, true);
    options.progresses.installTasks++;
    await _installOne(options.targetDir, childPkg, options, context);
  };

  // multi-thread installation
  await pMap(pkgs, mapper, 10);
  options.downloadFinished = Date.now();

  // link every packages' latest version to <root>/node_modules/.store/node_modules, fallback for peerDeps
  await linkAllLatestVersionToFallbackDir(rootPkgsMap, options);
  // https://pnpm.io/zh/next/npmrc#public-hoist-pattern
  await linkPublicHoistPackagesToRoot(rootPkgsMap, options, context);
  // workspace package should link deps to root/node_modules
  if (options.enableWorkspace && options.isWorkspacePackage) {
    const workspaceRootNodeModules = path.join(options.workspaceRoot, 'node_modules');
    const workspaceRootDepNames = await getWorkspaceRootDepNames(options, context);
    for (const pkg of pkgs) {
      const key = `install:${pkg.name}@${pkg.version}`;
      const c = options.cache[key];
      if (c && !workspaceRootDepNames.has(c.package.name)) {
        await linkHoistedPackage(
          {
            name: c.package.name,
            version: c.package.version,
            dir: c.dir,
          },
          workspaceRootNodeModules,
          options,
          context
        );
      }
    }
  }

  if (options.installRoot && !options.ignoreScripts) {
    if (options.failures.length > 0) {
      // 根包脚本通常依赖已安装的依赖, 有依赖失败时跳过, 下次运行成功后再执行
      options.console.warn(
        chalk.yellow('[np:runscript] skip %s lifecycle scripts because %s package(s) failed'),
        displayName,
        options.failures.length
      );
    } else {
      try {
        await runLifecycleScripts(rootPkg, options.root, { optional: false }, displayName, options);
      } catch (err) {
        options.failures.push({ displayName, error: err });
      }
    }
  }

  // link peerDependencies if not match the version in target directory
  if (options.deferPeerCheck) {
    // 根目录最后安装, 此时校验会把根目录提供的 peer 误报为未安装, 推迟到全部 workspace 安装完成后统一校验
    context.pendingPeerChecks.push(options);
  } else {
    await linkPeer(options);
  }

  // print all pending messages
  printPendingMessages(options);

  // record and print recently update modules
  recordRecentlyUpdates(options);

  // record all installed packages' versions
  recordPackageVersions(options);

  // record dependencies tree resolved from npm
  recordDependenciesTree(options);

  printOptionalFailures(options);
  const scriptPolicyError = allowScripts.report(options);
  if (scriptPolicyError) options.failures.push({ displayName: 'allowScripts', error: scriptPolicyError });
  if (options.failures.length > 0) {
    throw utils.installFailuresError(options.failures);
  }
  await utils.clearInstallStages(options);

  if (!options.ignoreScripts && options.runscriptCount > 0) {
    const runscriptInfo = util.format('Run %s script(s) in %s.', options.runscriptCount, ms(options.runscriptTime));
    if (options.spinner) {
      options.spinner.succeed(runscriptInfo);
    } else {
      console.info(runscriptInfo);
    }
  }

  options.spinner?.succeed(`Installed ${pkgs.length} packages on ${options.root}`);
  // print install finished
  finishInstall(options);

  await utils.removeInstallDone(options.root);
}

async function _installOne(parentDir, childPkg, options, context) {
  if (!(await needInstall(parentDir, childPkg, options))) {
    options.progresses.finishedInstallTasks++;
    const workspaceInfo = childPkg.workspacePackage && options.workspacesMap.get(childPkg.name);
    options.console.info(
      chalk.gray(`[${options.progresses.finishedInstallTasks}/${options.progresses.installTasks}]`),
      chalk.cyan('Package'),
      chalk.gray(childPkg.name + '@' + childPkg.version),
      workspaceInfo
        ? chalk.cyan('is skipped because it resolves to the local workspace:')
        : chalk.cyan('is skipped because it already exists at:'),
      workspaceInfo ? workspaceInfo.root : path.join(parentDir, 'node_modules', childPkg.name)
    );
    return;
  }

  const res = await installPackage(parentDir, childPkg, [], options, context);
  options.progresses.finishedInstallTasks++;
  if (res) {
    options.console.info(
      '[%s/%s] %s %s at %s',
      options.progresses.finishedInstallTasks,
      options.progresses.installTasks,
      chalk.gray(childPkg.name + '@' + childPkg.version),
      res.exists ? chalk.cyan('existed') : chalk.green('installed'),
      path.relative(parentDir, res.dir)
    );
  }
}

// 已装且等于锁定版本而被跳过的根依赖不会经过解析; 沿锁文件补记它的整棵子树, 否则完整安装会把这些条目当作无用删除
function recordLockedSubtree(rootDep, options) {
  const tree = options.cache.dependenciesTree;
  const stack = [[rootDep, []]];
  const seen = new Set();
  while (stack.length > 0) {
    const [dep, ancestors] = stack.pop();
    // 与安装时一致地套用 overrides / resolutions, 否则被改写的条目键对不上
    const resolved = ancestors.length > 0 ? options.lockResolution(dep, ancestors) : dep;
    const key = `${resolved.name}@${resolved.version}`;
    const manifest = tree[key];
    if (!manifest || seen.has(key)) continue;
    seen.add(key);
    options.lockPackages[key] = manifest;
    const childAncestors = ancestors.concat({ name: manifest.name, version: manifest.version });
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name in manifest[field]) {
        stack.push([{ name, version: manifest[field][name] }, childAncestors]);
      }
    }
  }
}

async function needInstall(parentDir, childPkg, options) {
  // ignore workspace package
  if (options.workspacesMap?.has(childPkg.name)) {
    debug('workspace package(%s) exists, skip install', childPkg.name);
    const { package } = options.workspacesMap.get(childPkg.name);
    childPkg.workspacePackage = package;
    // 始终链接本地 workspace; 版本不满足声明范围时只告警, 不改装 registry 同名包
    if (semver.validRange(childPkg.version) && !utils.fastSemverSatisfies(package.version, childPkg.version)) {
      options.console.warn(
        chalk.yellow(
          'np WARN: workspace package %s@%s does not satisfy %s required by %s, linked the local workspace anyway'
        ),
        package.name,
        package.version,
        childPkg.version,
        path.relative(options.workspaceRoot || options.root, options.root) || 'root'
      );
    }
    return false;
  }
  if (childPkg.workspaceProtocol) {
    throw new Error(`${childPkg.name} uses the workspace: protocol but no workspace named ${childPkg.name} was found`);
  }
  // always install if not install from package.json
  if (!options.installRoot || options.rebuild) return true;

  const pkgDir = path.join(parentDir, 'node_modules', childPkg.name);
  const pkg = await utils.readJSON(path.join(pkgDir, 'package.json'));
  try {
    if (pkg.name && pkg.version && childPkg.version && !(await utils.isInstallUnfinished(pkgDir))) {
      if (semver.validRange(childPkg.version, true) && utils.fastSemverSatisfies(pkg.version, childPkg.version)) {
        if (!options.lockPackages) return false;
        // 启用锁文件时只有已装版本等于锁定版本才跳过, 否则重装使 node_modules 与 np-lock.json 一致
        const locked = options.cache.dependenciesTree[`${childPkg.name}@${childPkg.version}`];
        if (locked && locked.version === pkg.version) {
          recordLockedSubtree(childPkg, options);
          return false;
        }
      }
    }
  } catch (err) {
    // ignore, maybe pkg.version invalid
    debug('[%s@%s] version invalid: %s', pkg.name, pkg.version, err);
  }
  // clean up
  if (childPkg.name) {
    await utils.rimraf(path.join(parentDir, 'node_modules', childPkg.name));
  }
  return true;
}

async function validatePeerDependencies(params, options) {
  const pkg = params.package;
  const packageDir = params.packageDir;

  const peerDependencies = pkg.peerDependencies;
  const names = Object.keys(peerDependencies);
  const cacheKey = `nodemodule:path:${packageDir}`;
  let paths = options.cache[cacheKey];
  if (!paths) {
    paths = options.cache[cacheKey] = Module._nodeModulePaths(packageDir);
  }
  for (const name of names) {
    const expectVersion = peerDependencies[name];
    const realPkg = await utils.getPkgFromPaths(name, paths);
    if (!realPkg) {
      options.console.warn(
        '%s %s requires a peer of %s but none was installed, packageDir: %s',
        chalk.red('peerDependencies WARNING'),
        chalk.gray(params.displayName),
        chalk.yellow(`${name}@${expectVersion}`),
        packageDir
      );
      continue;
    }
    if (!utils.fastSemverSatisfies(realPkg.version, expectVersion)) {
      options.console.warn(
        '%s %s requires a peer of %s but %s was installed at %s, packageDir: %s',
        chalk.red('peerDependencies WARNING'),
        chalk.gray(params.displayName),
        chalk.yellow(`${name}@${expectVersion}`),
        realPkg.installPath,
        chalk.yellow(`${name}@${realPkg.version}`),
        packageDir
      );
      continue;
    }
    debug(
      '%s requires a peer of %s and %s was installed at %s, packageDir: %s',
      chalk.green(params.displayName),
      chalk.green(`${name}@${expectVersion}`),
      chalk.green(`${name}@${realPkg.version}`),
      realPkg.installPath,
      packageDir
    );
  }
}

async function linkAllLatestVersionToFallbackDir(rootPkgsMap, options) {
  if (options.latestVersions.size > 0) {
    const mapper = async ([name, version]) => {
      if (!rootPkgsMap.has(name)) {
        options.progresses.linkTasks++;
        // link latest package to `<root>/node_modules/.store/node_modules`
        await linkLatestVersion(
          {
            name,
            version,
          },
          options.storeDir,
          options,
          true
        );
      }
    };
    await pMap(options.latestVersions, mapper, 20);
    const fallbackStoreDir = path.join(options.storeDir, '.store/node_modules');
    options.spinner?.succeed(
      `Linked ${options.latestVersions.size} latest versions as fallback to ${fallbackStoreDir}`
    );
  }
}

async function linkPublicHoistPackagesToRoot(rootPkgsMap, options, context) {
  if (options.publicHoistLatestVersions.size > 0) {
    const toWorkspaceRoot = options.enableWorkspace && options.isWorkspacePackage;
    const workspaceRootNodeModules = path.join(options.workspaceRoot, 'node_modules');
    const workspaceRootDepNames = toWorkspaceRoot ? await getWorkspaceRootDepNames(options, context) : null;
    // `np <pkg>` 时 rootPkgsMap 只含本次指定的包, 必须同时排除 package.json 已声明的依赖, 否则声明版本会被子依赖的高版本覆盖
    const declaredDepNames = getInstalledRootPkgNames(options);
    const mapper = async ([name, version]) => {
      if (!rootPkgsMap.has(name) && !declaredDepNames.has(name)) {
        // link public hoist package to `<root>/node_modules`
        await linkHoistedPackage({ name, version }, options.storeDir, options, context);
      }
      if (toWorkspaceRoot && !workspaceRootDepNames.has(name)) {
        // link public hoist package to `<workspaceRoot>/node_modules`
        await linkHoistedPackage({ name, version }, workspaceRootNodeModules, options, context);
      }
    };
    await pMap(options.publicHoistLatestVersions, mapper, 20);
    options.spinner?.succeed(
      `Linked ${options.publicHoistLatestVersions.size} public hoist packages to ${options.storeDir}`
    );
  }
}

// 同一次运行内同名包只链接最高版本; 完整安装时指向 .store 的已有链接视为旧的提升结果直接覆盖, 部分安装与其余已有目录仅在版本更低时覆盖, workspace 包永不覆盖
async function linkHoistedPackage(pkg, nodeModulesDir, options, context) {
  const linkDir = path.join(nodeModulesDir, pkg.name);
  options.progresses.linkTasks++;
  const linkedVersion = context.hoistedVersions.get(linkDir);
  const skip = linkedVersion
    ? !semver.gt(pkg.version, linkedVersion)
    : options.workspacesMap?.has(pkg.name) ||
      ((await utils.exists(linkDir)) &&
        (options.partialInstall || !(await utils.isStoreLink(linkDir))) &&
        !(await shouldOverrideLink(pkg, linkDir, options)));
  if (skip) {
    options.progresses.finishedLinkTasks++;
    return debug(
      '[%s/%s] %s keep %s',
      options.progresses.finishedLinkTasks,
      options.progresses.linkTasks,
      linkDir,
      linkedVersion || 'existing'
    );
  }
  context.hoistedVersions.set(linkDir, pkg.version);
  const realDir = pkg.dir || utils.getPackageStorePath(nodeModulesDir, pkg, options);
  const relative = await utils.forceSymlink(realDir, linkDir);
  options.progresses.finishedLinkTasks++;
  debug(
    '[%s/%s] %s@%s hoist %s => %s',
    options.progresses.finishedLinkTasks,
    options.progresses.linkTasks,
    pkg.name,
    pkg.version,
    linkDir,
    relative
  );
}

function getDeclaredDepNames(pkg) {
  const names = new Set();
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'clientDependencies',
    'buildDependencies',
    'isomorphicDependencies',
  ]) {
    for (const name in pkg[field] || {}) names.add(name);
  }
  return names;
}

async function getWorkspaceRootDepNames(options, context) {
  if (!context.workspaceRootDepNames) {
    context.workspaceRootDepNames = getDeclaredDepNames(
      await utils.readJSON(path.join(options.workspaceRoot, 'package.json'))
    );
  }
  return context.workspaceRootDepNames;
}

// 当前安装模式下 package.json 声明且会被安装的直接依赖名
function getInstalledRootPkgNames(options) {
  const { rootPkgDependencies } = options;
  let rootPkgs;
  if (options.client) {
    rootPkgs = rootPkgDependencies.client;
  } else if (options.production) {
    rootPkgs = rootPkgDependencies.prod;
  } else {
    rootPkgs = rootPkgDependencies.all;
  }
  return new Set(rootPkgs.map(rootPkg => rootPkg.name));
}

async function shouldOverrideLink(pkg, linkDir, options) {
  // if root packages include this package, then do not link
  if (getInstalledRootPkgNames(options).has(pkg.name)) {
    return false;
  }

  const pkgJSONPath = path.join(linkDir, 'package.json');
  try {
    const pkgJSON = await utils.readJSON(pkgJSONPath);
    if (semver.gt(pkg.version, pkgJSON.version)) {
      // pkg is the newer version
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

async function linkLatestVersion(pkg, storeDir, options, isFallback = false) {
  // storeDir: <root>/node_modules
  const linkDir = isFallback ? path.join(storeDir, '.store/node_modules', pkg.name) : path.join(storeDir, pkg.name);
  if ((await utils.exists(linkDir)) && !(await shouldOverrideLink(pkg, linkDir, options))) {
    options.progresses.finishedLinkTasks++;
    return debug(
      '[%s/%s] %s already exists',
      options.progresses.finishedLinkTasks,
      options.progresses.linkTasks,
      linkDir
    );
  }
  await utils.rimraf(linkDir); // make sure to delete linkDir
  await utils.mkdirp(path.dirname(linkDir));
  const realDir = utils.getPackageStorePath(storeDir, pkg, options);
  const relative = await utils.forceSymlink(realDir, linkDir);
  options.progresses.finishedLinkTasks++;
  debug(
    '[%s/%s] %s@%s link %s => %s',
    options.progresses.finishedLinkTasks,
    options.progresses.linkTasks,
    pkg.name,
    pkg.version,
    linkDir,
    relative
  );
}

// 可选依赖失败不影响安装结果, 也不会被之后的 np 重试, 结束时集中提示
function printOptionalFailures(options) {
  const items = options.optionalFailures;
  if (items.length === 0) return;
  options.console.warn(chalk.yellow('%s optional package(s) failed and were skipped:'), items.length);
  for (const { displayName, error } of items) {
    options.console.warn(chalk.yellow('  - %s: %s'), displayName, String(error.message).split('\n')[0]);
  }
  const names = [...new Set(items.filter(item => item.name).map(item => item.name))];
  if (names.length > 0) {
    options.console.warn(chalk.yellow('rerun their scripts with: np-x rebuild %s'), names.join(' '));
  }
}

function printPendingMessages(options) {
  for (const item of options.pendingMessages) {
    if (options.console[item[0]] && options.console[item[0]] !== debug) {
      options.console[item[0]](...item.slice(1));
    }
  }
}

async function linkPeer(options) {
  if (options.peerDependencies.length > 0) {
    await Promise.all(options.peerDependencies.map(item => validatePeerDependencies(item, options)));
  }
}

module.exports.validatePendingPeerDependencies = async context => {
  const pending = context.pendingPeerChecks.splice(0);
  for (const options of pending) {
    await linkPeer(options);
  }
};

function recordRecentlyUpdates(options) {
  if (options.recentlyUpdates.size > 0) {
    const since = dayjs(options.recentlyUpdateMinDateTime).format('YYYY-MM-DD');
    const recentlyUpdatesTextFile = path.join(options.storeDir, '.recently_updates.txt');
    let recentlyUpdatesText = `Recently updated (since ${since})`;
    console.info(
      '%s: %s %s',
      chalk.gray(recentlyUpdatesText),
      `${chalk.green(options.recentlyUpdates.size)} packages`,
      chalk.gray(`(see details in ${recentlyUpdatesTextFile})`)
    );
    const displays = {};
    for (const item of options.recentlyUpdates) {
      const name = item[0];
      const publishDate = dayjs(item[1]);
      const key = publishDate.format('YYYY-MM-DD');
      const list = displays[key] || [];
      list.push(`${name} ${chalk.gray(publishDate.format('(HH:mm:ss)'))}`);
      displays[key] = list;
    }

    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().add(-1, 'day').format('YYYY-MM-DD');
    const keys = Object.keys(displays).sort((a, b) => {
      return a > b ? -1 : 1;
    });

    recentlyUpdatesText += '\n';
    for (const key of keys) {
      const isToday = key === today;
      const isYesterday = key === yesterday;
      const label = isToday ? 'Today:' : key;
      // today or yesterday
      const logToConsole =
        !options.onlyShowTodayUpdateToConsole || (options.onlyShowTodayUpdateToConsole && (isToday || isYesterday));
      const text = `  ${label}`;
      recentlyUpdatesText += `${text}\n`;

      if (logToConsole) console.info(chalk.gray(text));
      const list = displays[key];
      for (const message of list) {
        const text = `    ${chalk.green('→')} ${message}`;
        recentlyUpdatesText += `${text}\n`;

        if (logToConsole) console.info(text);
      }
    }
    writeFileSync(recentlyUpdatesTextFile, recentlyUpdatesText);
  }
}

function recordPackageVersions(options) {
  if (!options.installRoot) return;
  const versions = {};
  for (const pkg in options.packageVersions) {
    versions[pkg] = Array.from(options.packageVersions[pkg]);
  }
  const packageVersionsFile = path.join(options.storeDir, '.package_versions.json');
  writeFileSync(packageVersionsFile, JSON.stringify(versions, null, 2));
}

function recordDependenciesTree(options) {
  if (!options.saveDependenciesTree) return;

  const tree = {};
  for (const key in options.cache.dependenciesTree) {
    tree[key] = utils.omitPackage(options.cache.dependenciesTree[key]);
  }
  const installCacheFile = path.join(options.storeDir, '.dependencies_tree.json');
  writeFileSync(installCacheFile, JSON.stringify(tree, null, 2));
}

function finishInstall(options) {
  const totalUse = Date.now() - options.start;
  const downloadUse = options.downloadFinished - options.start;
  const totalSize = options.totalTarballSize + options.totalJSONSize;
  const avgSpeed = (totalSize / downloadUse) * 1000;
  const logArguments = [
    chalk[options.detail ? 'green' : 'white'](
      'All packages installed (%s%s%s%sused %s(network %s), speed %s/s, json %s(%s), tarball %s, manifests cache hit %s, etag hit %s / miss %s)'
    ),
    options.registryPackages ? `${options.registryPackages} packages installed from npm registry, ` : '',
    options.remotePackages ? `${options.remotePackages} packages installed from remote url, ` : '',
    options.localPackages ? `${options.localPackages} packages installed from local file, ` : '',
    options.gitPackages ? `${options.gitPackages} packages installed from git, ` : '',
    ms(totalUse),
    ms(downloadUse),
    bytes(avgSpeed),
    options.totalJSONCount,
    bytes(options.totalJSONSize),
    bytes(options.totalTarballSize),
    options.totalCacheJSONCount,
    options.totalEtagHitCount,
    options.totalEtagMissCount,
  ];
  if (options.spinner) {
    options.spinner.succeed(util.format(...logArguments));
  } else {
    options.console.info(...logArguments);
  }
}
