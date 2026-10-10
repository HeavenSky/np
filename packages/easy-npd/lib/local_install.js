/**
 * impl npm install [pkg1, pkg2, ...]
 */

const debug = require('debug')('npd:local_install');
const chalk = require('chalk');
const path = require('path');
const os = require('os');
const ms = require('ms');
const pMap = require('p-map');
const semver = require('semver');
const bytes = require('bytes');
const Module = require('module');
const { writeFileSync } = require('fs');
const fs = require('fs/promises');
const dayjs = require('dayjs');
const util = require('util');
const utils = require('./utils');
const mirror = require('./mirror');
const postinstall = require('./postinstall');
const preinstall = require('./preinstall');
const prepublish = require('./prepublish');
const prepare = require('./prepare');
const allowScripts = require('./allow_scripts');
const npLock = require('./np_lock');
const install = require('./install');
const dependencies = require('./dependencies');
const createResolution = require('./resolution');
const formatInstallOptions = require('./format_install_options');
const link = require('./link');
const bin = require('./bin');
const Context = require('./context');

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
 *  - {Object} [binaryMirrors] - binary mirror config, default is `{}`
 *  - {Boolean} [ignoreScripts] - ignore pre / post install scripts, default is `false`
 *  - {Array} [forbiddenLicenses] - forbid installing packages that use these licenses
 *  - {Boolean} [trace] - show memory and CPU usage traces of the installation
 *  - {Boolean} [flatten] - flatten dependencies by matching ancestors' dependencies
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

exports.runPostInstallTasks = runPostInstallTasks;

async function _install(options, context) {
  const rootPkgFile = path.join(options.root, 'package.json');
  const rootPkg = await utils.readJSON(rootPkgFile);
  const displayName = `${rootPkg.name}@${rootPkg.version}`;
  let pkgs = options.pkgs;
  const rootPkgDependencies = dependencies(rootPkg, options, context.nested, options.rootFields);
  options.rootPkgDependencies = rootPkgDependencies;
  options.resolution = createResolution(rootPkg, options);
  if (pkgs.length === 0) {
    if (options.production) {
      pkgs = rootPkgDependencies.prod;
    } else {
      pkgs = rootPkgDependencies.all;
    }
    debug(
      `about to locally install pkgs (production: ${options.production}, rootFields: ${options.rootFields}): ${JSON.stringify(pkgs, null, 2)}`
    );
  } else {
    // try to fix no version package from rootPkgDependencies
    const allDeps = rootPkgDependencies.allMap;
    for (const childPkg of pkgs) {
      if (!childPkg.version && allDeps[childPkg.name]) {
        childPkg.version = allDeps[childPkg.name];
        debug('auto fill version: %j', childPkg);
      }
    }
  }

  if (options.installRoot) await preinstall(rootPkg, options.root, displayName, options);

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
    await installOne(options.targetDir, childPkg, options, context);
  };

  await pMap(pkgs, mapper, 10);
  options.downloadFinished = Date.now();
  if (options.spinner) options.spinner.succeed(`Installed ${pkgs.length} packages`);

  // dedupe mode https://docs.npmjs.com/cli/dedupe
  // link every packages' latest version to target directory
  // won't override exists target directory
  await linkAllLatestVersion(rootPkgsMap, options);

  // run postinstall script if exist
  if (options.installRoot) await postinstall(rootPkg, options.root, false, displayName, options);
  // run dependencies' postinstall scripts
  await runPostInstallTasks(options);

  // local install trigger prepublish / prepare when no packages and non-production mode
  // prepare is run after prepublish
  // see:
  // - https://docs.npmjs.com/misc/scripts
  // - https://github.com/npm/npm/issues/3059#issuecomment-32057292
  // 根包脚本通常依赖已安装的依赖, 有依赖失败时跳过, 下次运行成功后再执行
  if (options.installRoot && !options.production && options.failures.length === 0) {
    try {
      await prepublish(rootPkg, options.root, options);
      await prepare(rootPkg, options.root, options);
    } catch (err) {
      options.failures.push({ displayName, error: err });
    }
  }

  // link peerDependencies if not match the version in target directory
  await linkPeer(options);

  // print all pending messages
  printPendingMessages(options);

  // record and print recently update modules
  recordRecentlyUpdates(options);

  // record all installed packages' versions
  recordPackageVersions(options);

  // record dependencies tree resolved from npm
  printOptionalFailures(options);
  const scriptPolicyError = allowScripts.report(options);
  if (scriptPolicyError) options.failures.push({ displayName: 'allowScripts', error: scriptPolicyError });
  if (options.failures.length > 0) {
    throw utils.installFailuresError(options.failures);
  }

  // print install finished
  finishInstall(options);
}

async function installOne(parentDir, childPkg, options, context) {
  if (!(await needInstall(parentDir, childPkg, options))) {
    options.progresses.finishedInstallTasks++;
    options.console.info(
      chalk.gray(`[${options.progresses.finishedInstallTasks}/${options.progresses.installTasks}]`),
      chalk.cyan('Package '),
      chalk.gray(childPkg.name + '@' + childPkg.version),
      chalk.cyan('is skipped because it already exists at:'),
      path.join(parentDir, 'node_modules', childPkg.alias || childPkg.name)
    );
    return;
  }

  const res = await install(parentDir, childPkg, [], options, context);
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

async function needInstall(parentDir, childPkg, options) {
  // always install if not install from package.json
  if (!options.installRoot || options.rebuild) return true;

  const pkgDir = path.join(parentDir, 'node_modules', childPkg.alias || childPkg.name);
  const pkg = await utils.readJSON(path.join(pkgDir, 'package.json'));
  try {
    if (pkg.name && pkg.version && childPkg.version && !(await utils.isInstallUnfinished(pkgDir))) {
      // 启用锁文件时已装的根依赖仍要走一遍安装, 否则子依赖不会按锁定版本校正, 也不会记进 np-lock.json; 已装的就是锁定版本时只是不删链接
      const locked =
        options.lockPackages && npLock.lookup(options.cache.dependenciesTree, `${childPkg.name}@${childPkg.version}`);
      // 声明从 git / url / 本地路径改回 registry 版本时, 版本满足范围的旧包也要换成 registry 包
      if (
        semver.validRange(childPkg.version, true) &&
        semver.satisfies(pkg.version, childPkg.version) &&
        !utils.isNonRegistryInstall(pkg)
      ) {
        if (!options.lockPackages) return false;
        if (locked && locked.version === pkg.version) return true;
      }
      // git 与 tarball url 依赖: 已装的就是锁定的 commit 或 url; 锁文件里的地址去掉了凭据
      if (locked && locked._resolved && utils.stripUrlAuth(pkg._resolved) === utils.stripUrlAuth(locked._resolved)) {
        return true;
      }
    }
  } catch (err) {
    // ignore, maybe pkg.version invalid
    debug('[%s@%s] version invalid: %s', pkg.name, pkg.version, err);
  }
  // clean up
  if (childPkg.name) {
    await utils.rimraf(pkgDir);
  }
  return true;
}

async function checkLinkPeerDependencies(params, options) {
  const parentDir = params.parentDir;
  const realPkg = params.realPkg;
  const realPkgDir = params.realPkgDir;

  let rootPkg = {};
  try {
    rootPkg = await utils.readJSON(path.join(options.targetDir, 'node_modules', realPkg.name, 'package.json'));
    if (rootPkg.version === realPkg.version) return;
  } catch {
    // ignore
  }
  options.console.warn(
    '%s %s in %s unmet with %s(%s)',
    chalk.yellow('peerDependencies link'),
    chalk.yellow(`${realPkg.name}@${realPkg.version}`),
    chalk.gray(parentDir),
    chalk.gray(path.join(options.targetDir, 'node_modules', realPkg.name)),
    chalk.yellow(rootPkg.version || '-')
  );
  await bin(parentDir, realPkg, realPkgDir, options);
  await link(parentDir, realPkg, realPkgDir);
}

async function validatePeerDependencies(params, options) {
  const parentDir = params.parentDir;

  const peerDependencies = params.peerDependencies;
  const names = Object.keys(peerDependencies);
  const cacheKey = `nodemodule:path:${parentDir}`;
  let paths = options.cache[cacheKey];
  if (!paths) {
    paths = options.cache[cacheKey] = Module._nodeModulePaths(parentDir);
  }
  for (const name of names) {
    const expectVersion = peerDependencies[name];
    const realPkg = await utils.getPkgFromPaths(name, paths);
    if (!realPkg) {
      options.console.warn(
        '%s %s requires a peer of %s but none was installed',
        chalk.red('peerDependencies WARNING'),
        chalk.gray(params.displayName),
        chalk.yellow(`${name}@${expectVersion}`)
      );
      continue;
    }
    if (!semver.satisfies(realPkg.version, expectVersion)) {
      options.console.warn(
        '%s %s requires a peer of %s but %s was installed',
        chalk.red('peerDependencies WARNING'),
        chalk.gray(params.displayName),
        chalk.yellow(`${name}@${expectVersion}`),
        chalk.yellow(`${name}@${realPkg.version}`)
      );
      continue;
    }
    debug(
      '%s requires a peer of %s and %s was installed at %s',
      chalk.green(params.displayName),
      chalk.green(`${name}@${expectVersion}`),
      chalk.green(`${name}@${realPkg.version}`),
      realPkg.installPath
    );
  }
}

async function linkAllLatestVersion(rootPkgsMap, options) {
  if (options.latestVersions.size > 0) {
    const mapper = async ([name, version]) => {
      if (!rootPkgsMap.has(name)) {
        options.progresses.linkTasks++;
        // link latest package to `storeDir/node_modules`
        await linkLatestVersion(
          {
            name,
            version,
          },
          options.storeDir,
          options
        );
      }
    };
    await pMap(options.latestVersions, mapper, 20);
  }
  if (options.spinner) options.spinner.succeed(`Linked ${options.latestVersions.size} latest versions`);
}

// 根目录直接依赖与提升链接都指向 _name@ver@name, 只能按 package.json 声明名单区分, 声明过的包永不覆盖
function isDeclaredRootPkg(name, options) {
  const { rootPkgDependencies } = options;
  return name in rootPkgDependencies.allMap;
}

// 完整安装时指向本 storeDir 下 _name@ver@name 的链接视为上次的提升结果, 直接更新为本次依赖树中的最高版本
async function isHoistedLink(pkg, linkDir, storeDir, options) {
  if (options.pkgs.length > 0) return false;
  try {
    const target = path.resolve(path.dirname(linkDir), await fs.readlink(linkDir));
    const prefix = `_${pkg.name.replace(/\//g, '_')}@`;
    const basename = path.basename(target);
    return (
      path.dirname(target) === path.resolve(storeDir) &&
      basename.startsWith(prefix) &&
      basename.endsWith(`@${path.basename(pkg.name)}`)
    );
  } catch {
    return false;
  }
}

async function shouldOverrideLink(pkg, linkDir, storeDir, options) {
  if (isDeclaredRootPkg(pkg.name, options)) return false;
  if (await isHoistedLink(pkg, linkDir, storeDir, options)) return true;

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

async function linkLatestVersion(pkg, storeDir, options) {
  const linkDir = path.join(storeDir, pkg.name);
  if ((await utils.exists(linkDir)) && !(await shouldOverrideLink(pkg, linkDir, storeDir, options))) {
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
  const realDir = options.latestPackages.get(pkg.name);
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

async function runPostInstallTasks(options) {
  let count = 0;
  const total = options.postInstallTasks.length;
  if (total && options.ignoreScripts) {
    options.console.warn(chalk.yellow('ignore all post install scripts'));
    if (options.failures.length === 0) await clearInstallStages(options);
    return;
  }

  if (total) {
    options.console.log(chalk.yellow(`execute ${total} postinstall scripts...`));
  }

  for (const task of options.postInstallTasks) {
    count++;
    if (task.root === options.root && options.failures.length > 0) {
      options.console.warn(
        chalk.yellow('[npd:runscript] skip %s lifecycle scripts because %s package(s) failed'),
        task.displayName,
        options.failures.length
      );
      continue;
    }
    const pkg = task.pkg;
    const root = task.root;
    const displayName = task.displayName;
    const stage = task.stage;
    const installScript = utils.shouldRunStage(stage, 'install') && pkg.scripts.install;
    const postinstallScript = pkg.scripts.postinstall;
    try {
      if (installScript) {
        if (stage) await utils.setInstallStage(root, 'install');
        options.console.warn(
          '%s %s run %j, root: %j',
          chalk.yellow(`[${count}/${total}] scripts.install`),
          chalk.gray(displayName),
          installScript,
          root
        );
        const start = Date.now();
        try {
          await mirror.runScript(root, installScript, options);
        } catch (err) {
          options.console.warn(
            '[npd:runscript:error] %s scripts.install run %j error: %s',
            chalk.red(displayName),
            installScript,
            err
          );
          err.message = `run install error\n${err.message}`;
          throw err;
        }
        options.console.warn(
          '%s %s finished in %s',
          chalk.yellow(`[${count}/${total}] scripts.install`),
          chalk.gray(displayName),
          ms(Date.now() - start)
        );
      }
      if (postinstallScript) {
        if (stage) await utils.setInstallStage(root, 'postinstall');
        options.console.warn(
          '%s %s run %j, root: %j',
          chalk.yellow(`[${count}/${total}] scripts.postinstall`),
          chalk.gray(displayName),
          postinstallScript,
          root
        );
        const start = Date.now();
        try {
          await mirror.runScript(root, postinstallScript, options);
        } catch (err) {
          options.console.warn(
            '[npd:runscript:error] %s scripts.postinstall run %j error: %s',
            chalk.red(displayName),
            postinstallScript,
            err
          );
          err.message = `run postinstall error\n${err.message}`;
          throw err;
        }
        options.console.warn(
          '%s %s finished in %s',
          chalk.yellow(`[${count}/${total}] scripts.postinstall`),
          chalk.gray(displayName),
          ms(Date.now() - start)
        );
      }
      if (stage) await utils.setInstallStage(root, 'finish');
    } catch (err) {
      // 阶段停在失败的脚本, 下次运行从这里继续; 失败被忽略的可选依赖不随本次运行清除标记
      options.stagedDirs.delete(root);
      if (task.optional) {
        console.warn(chalk.red('%s optional error: %s'), displayName, err.stack);
        options.optionalFailures.push({ displayName, error: err, name: pkg.name });
        continue;
      }
      // 不中止其余脚本, 安装结束时汇总
      options.failures.push({ displayName, error: err });
    }
  }
  // 有失败时保留本次运行全部阶段标记, 下次运行经由上层包找到失败的包
  if (options.failures.length === 0) await clearInstallStages(options);
  if (options.spinner) options.spinner.succeed(`Run ${options.postInstallTasks.length} scripts`);
}

async function clearInstallStages(options) {
  await pMap(options.stagedDirs, dir => utils.setInstallStage(dir), 10);
  options.stagedDirs.clear();
}

// 可选依赖失败不影响安装结果, 也不会被之后的 npd 重试, 结束时集中提示
function printOptionalFailures(options) {
  const items = options.optionalFailures;
  if (items.length === 0) return;
  options.console.warn(chalk.yellow('%s optional package(s) failed and were skipped:'), items.length);
  for (const { displayName, error } of items) {
    options.console.warn(chalk.yellow('  - %s: %s'), displayName, String(error.message).split('\n')[0]);
  }
  const names = [...new Set(items.filter(item => item.name).map(item => item.name))];
  if (names.length > 0) {
    options.console.warn(chalk.yellow('rerun their scripts with: npd-x rebuild %s'), names.join(' '));
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
  // only when root dependencies unmet peer dependencies
  // link the matched one as a dependencies
  // ensure peer dependencies flatten by default
  if (options.linkPeerDependencies.length) {
    await Promise.all(options.linkPeerDependencies.map(item => checkLinkPeerDependencies(item, options)));
  }
  if (options.peerDependencies.length) {
    await Promise.all(options.peerDependencies.map(item => validatePeerDependencies(item, options)));
  }
}

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
    const keys = Object.keys(displays).sort((a, b) => {
      return a > b ? -1 : 1;
    });

    recentlyUpdatesText += '\n';
    for (const key of keys) {
      const isToday = key === today;
      const label = isToday ? 'Today:' : key;
      const logToConsole = !options.onlyShowTodayUpdateToConsole || (options.onlyShowTodayUpdateToConsole && isToday);
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
