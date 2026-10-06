const path = require('node:path');
const os = require('node:os');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const ms = require('ms');
const { LOCAL_TYPES } = require('./npa_types');
const utils = require('./utils');
const { MIRROR_ATTEMPTS } = require('./get');
const { useBinarySource } = require('./download/npm');
const allowScripts = require('./allow_scripts');

// scripts that should run in root package and linked package
exports.DEFAULT_ROOT_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
];

// scripts that should run in dependencies
exports.DEFAULT_DEP_SCRIPTS = ['preinstall', 'install', 'postinstall'];

// stage: 依赖包上次停在的阶段, 从该脚本继续并逐个推进阶段标记; 根包不传, 不写标记
// 返回可选依赖第一个失败的脚本名, 其余失败直接抛出
exports.runLifecycleScripts = async function runLifecycleScripts(
  pkg,
  root,
  originPkg,
  displayName,
  globalOptions,
  stage
) {
  const scripts = pkg.scripts || {};

  // https://docs.npmjs.com/misc/scripts#default-values
  // "install": "node-gyp rebuild"
  // If there is a binding.gyp file in the root of your package,
  // npm will default the install command to compile using node-gyp.
  if (!scripts.install && (await utils.exists(path.join(root, 'binding.gyp')))) {
    globalOptions.console.info(
      '[np:runscript] %s found binding.gyp file, auto run "node-gyp rebuild", root: %j',
      displayName,
      root
    );
    scripts.install = 'node-gyp rebuild';
  }

  let scriptList = exports.DEFAULT_DEP_SCRIPTS;
  let runInForeground = !!globalOptions.foregroundScripts;
  const isRoot = root === globalOptions.root && !globalOptions.global;
  const originType = isRoot ? null : typeOf(originPkg);
  if (isRoot || LOCAL_TYPES.includes(originType)) {
    scriptList = exports.DEFAULT_ROOT_SCRIPTS;
    runInForeground = true;
  } else {
    const pending = scriptList.filter(script => scripts[script]);
    const identity = allowScripts.identityOf(originType, pkg, originPkg.version);
    if (
      pending.length > 0 &&
      !allowScripts.allow(globalOptions, identity, { displayName, name: pkg.name, scripts: pending })
    ) {
      return undefined;
    }
  }

  // 依赖的安装脚本会自行下载二进制, 失败时切换二进制镜像与官方地址重试
  const mirrorState = scriptList === exports.DEFAULT_DEP_SCRIPTS && globalOptions.mirror;
  const binarySource = { current: mirrorState && mirrorState.binaryOrder[0] };

  // 可选依赖的脚本失败后继续执行后续脚本, 但阶段停在第一个失败的脚本, 下次运行重试
  let failedScript;
  for (const script of scriptList.slice(Math.max(scriptList.indexOf(stage), 0))) {
    const cmd = scripts[script];
    if (!cmd) {
      continue;
    }

    if (stage) await utils.setInstallStage(root, script);
    if (runInForeground) console.info('> %s %s %s %s> %s', displayName, script, root, os.EOL, cmd);
    const startTime = Date.now();
    try {
      await runScriptWithMirrors(root, cmd, displayName, script, binarySource, globalOptions, runInForeground);
    } catch (error) {
      globalOptions.console.warn(
        '[np:runscript:error] %s run %s %s error: %s',
        chalk.red(displayName),
        script,
        cmd,
        error
      );
      if (originPkg.optional) {
        globalOptions.console.warn(chalk.red('%s optional error: %s'), displayName, error.stack);
        failedScript = failedScript || script;
        continue;
      }
      error.message = `run ${script} error\n${error.message}`;
      throw error;
    } finally {
      const ts = Date.now() - startTime;
      if (runInForeground) console.info('> %s %s, finished in %s', displayName, script, ms(ts));
      globalOptions.runscriptCount += 1;
      globalOptions.runscriptTime += ts;
    }
  }
  return failedScript;
};

// 全局安装的包自身作为根传入, 没有依赖声明, 按 registry 包处理;
// 命令行直接安装本地目录时 name 为空, 拼成 `@../dir` 会被当作 tag 而按依赖处理
function typeOf(originPkg) {
  if (!originPkg.version) return 'version';
  return npa(originPkg.name ? `${originPkg.name}@${originPkg.version}` : originPkg.version).type;
}

async function runScriptWithMirrors(root, cmd, displayName, script, binarySource, globalOptions, runInForeground) {
  const mirrorState = binarySource.current && globalOptions.mirror;
  if (!mirrorState) {
    return await utils.runScript(root, cmd, globalOptions, runInForeground);
  }
  for (let attempt = 1; ; attempt++) {
    const env = { ...globalOptions.env };
    for (const key in mirrorState.binaryEnvs) delete env[key];
    if (binarySource.current === 'mirror') Object.assign(env, mirrorState.binaryEnvs);
    try {
      return await utils.runScript(root, cmd, { ...globalOptions, env }, runInForeground);
    } catch (err) {
      if (attempt >= MIRROR_ATTEMPTS) throw err;
      binarySource.current = mirrorState.binaryOrder.find(name => name !== binarySource.current);
      globalOptions.console.warn(
        chalk.yellow('[np:runscript] %s %s failed, retry with %s binary source (%s/%s): %s'),
        displayName,
        script,
        binarySource.current,
        attempt + 1,
        MIRROR_ATTEMPTS,
        err.message
      );
      await useBinarySource(root, binarySource.current, globalOptions);
    }
  }
}
