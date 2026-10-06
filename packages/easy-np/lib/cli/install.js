const debug = require('node:util').debuglog('np:cli:install');
const path = require('node:path');
const util = require('node:util');
const { execSync } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs/promises');
const { writeFileSync } = require('node:fs');
const chalk = require('chalk');
const parseArgs = require('minimist');
const { installLocal, installGlobal, validatePendingPeerDependencies, fetchOnly, rebuild } = require('..');
const npa = require('../npa');
const utils = require('../utils');
const globalConfig = require('../config');
const { parsePackageName } = require('../alias');
const { LOCAL_TYPES, REMOTE_TYPES, ALIAS_TYPES } = require('../npa_types');
const Context = require('../context');
const mirror = require('../mirror');
const { lockfileConverter } = require('../lockfile_resolver');
const npLock = require('../np_lock');
const proxy = require('../proxy');
const runtime = require('../runtime');
const allowScripts = require('../allow_scripts');
const help = require('./help');

// 命令行未出现时删掉 minimist 补的默认 false, 否则会盖过环境变量与 ~/.nprc, 例如未传 --strict-ssl 也关闭证书校验
const TRI_STATE_FLAGS = ['strict-ssl', 'strict-allow-scripts', 'dangerously-allow-all-scripts'];
// 可以重复传入的参数, 其余参数重复时与 npm 一致取最后一个
const MULTI_VALUE_ARGS = new Set(['_', 'allow-scripts', 'workspace', 'w']);

module.exports = async function install(args, { ignorePkgNames = false, ignoreLockfile = false } = {}) {
  try {
    await main(args, { ignorePkgNames, ignoreLockfile });
  } catch (err) {
    utils.exitWithError('np', err);
  }
};

async function main(args, { ignorePkgNames = false, ignoreLockfile = false } = {}) {
  const originalArgv = args;

  // since minimist consider --no-xx is xx:false, we handle it manually here
  const argv = { 'no-save': originalArgv.includes('--no-save') };
  Object.assign(
    argv,
    parseArgs(originalArgv, {
      string: [
        'root',
        'registry',
        'prefix',
        'forbidden-licenses',
        // {"http://a.com":"http://b.com"}
        'tarball-url-mapping',
        'proxy',
        'https-proxy',
        'noproxy',
        'cafile',
        'allow-scripts',
        'dependencies-tree',
        // np foo --workspace=aa
        // np foo -w aa
        'workspace',
        /**
         * set package-lock.json path
         *
         * 1. only support package lock v2 and v3.
         * 2. np doesn't inspect <cwd>/package-lock.json by default.
         * 3. because arborist doesn't support client/build/isomorphic dependencies,
         *    these kinds of dependencies will all be ignored.
         * 4. this option doesn't do extra check for the equivalence of package-lock.json and package.json
         *    simply behaves like `npm ci` but doesn't remove the node_modules in advance.
         * 5. you're not supposed to install extra dependencies along with a lockfile.
         */
        'lockfile-path',
        'probe-cache',
        'public-hoist-pattern',
      ],
      boolean: [
        'version',
        'help',
        'production',
        'client',
        'global',
        'save',
        'save-dev',
        'save-optional',
        'save-client',
        'save-build',
        'save-isomorphic',
        // Saved dependencies will be configured with an exact version rather than using npm's default semver range operator.
        'save-exact',
        'ignore-scripts',
        // run scripts on foreground, default is background
        'foreground-scripts',
        // install ignore optionalDependencies
        'optional',
        'detail',
        'trace',
        'engine-strict',
        'legacy-peer-deps',
        'flatten',
        'registry-only',
        'cache-strict',
        'fix-bug-versions',
        // --prune 已移除: 按固定名单跳过解压文件会误删 tsconfig.json 等运行时文件
        'save-dependencies-tree',
        'fetch-only',
        // --force-link-latest 已移除: 提升到根目录时始终链接最高版本
        'dedup',
        'workspaces',
        'offline',
        'refresh-cache',
        'frozen-lockfile',
        'rebuild',
        ...TRI_STATE_FLAGS,
      ],
      default: {
        optional: true,
      },
      alias: {
        // npm install [-S|--save|-D|--save-dev|-O|--save-optional] [-E|--save-exact] [-d|--detail] [-w|--workspace]
        S: 'save',
        D: 'save-dev',
        O: 'save-optional',
        E: 'save-exact',
        v: 'version',
        h: 'help',
        g: 'global',
        r: 'registry',
        d: 'detail',
        w: 'workspace',
      },
    })
  );

  const flagArgs = originalArgv.includes('--') ? originalArgv.slice(0, originalArgv.indexOf('--')) : originalArgv;
  for (const name of TRI_STATE_FLAGS) {
    if (!flagArgs.some(arg => arg === `--${name}` || arg === `--no-${name}` || arg.startsWith(`--${name}=`))) {
      delete argv[name];
    }
  }
  for (const [name, value] of Object.entries(argv)) {
    if (Array.isArray(value) && !MULTI_VALUE_ARGS.has(name)) argv[name] = value[value.length - 1];
  }

  if (argv.version) {
    console.log(`np v${require('../../package.json').version}`);
    process.exit(0);
  }

  if (argv.help && argv['fetch-only']) {
    console.log(help.fetch());
    process.exit(0);
  }

  if (argv.help && argv.rebuild) {
    console.log(help.rebuild());
    process.exit(0);
  }

  if (argv.help) {
    console.log(help.install());
    process.exit(0);
  }

  // 首个网络请求与子进程启动之前写入, 安装脚本, node-gyp 与 git 通过环境变量继承
  proxy.configure(argv);
  // 下面按 argv 生成的 npm_config_* 会覆盖给安装脚本, 必须用 proxy 转换后的绝对路径
  if (argv.cafile) argv.cafile = process.env.npm_config_cafile;
  runtime.warnIfDegraded();

  const pkgs = [];

  if (ignorePkgNames) {
    // ignore all package names on update
    argv._ = [];
  }

  const context = new Context();
  for (const name of argv._) {
    context.nested.update([name]);
    const [aliasPackageName] = parsePackageName(name, context.nested);
    const p = npa(name, { where: argv.root, nested: context.nested });
    pkgs.push({
      name: p.name,
      // `mozilla/nunjucks#0f8b21b8df7e8e852b2e1889388653b7075f0d09` should be rawSpec
      // `np foo` 未写版本时 npa 补成 latest tag, 改传 `*` 以便选版时与显式的 `foo@latest` 区分并检查 engines
      version: p.type === 'tag' && !p.rawSpec ? '*' : p.fetchSpec || p.rawSpec,
      type: p.type,
      alias: aliasPackageName,
      arg: p,
    });
  }

  const root = argv.root || process.cwd();
  let installOnAllWorkspaces = argv.workspaces;
  let installWorkspaceNames = utils.formatWorkspaceNames(argv);
  const production = argv.production || process.env.NODE_ENV === 'production';
  const cacheStrict = argv['cache-strict'];
  // support npm_config_cache to change default cache dir
  const defaultCacheDir = process.env.npm_config_cache || path.join(os.homedir(), '.np_tarball');
  let cacheDir = defaultCacheDir;
  if (!cacheStrict && (production || argv.cache === false)) {
    cacheDir = '';
  }
  if (process.env.np_cache) {
    cacheDir = process.env.np_cache;
  }
  // 测速缓存不受 --production 关闭磁盘缓存影响, 只在 --no-cache 时停用
  const probeCacheDir = argv.cache === false ? '' : process.env.np_cache || defaultCacheDir;

  let forbiddenLicenses = argv['forbidden-licenses'];
  forbiddenLicenses = forbiddenLicenses ? forbiddenLicenses.split(',') : null;

  const flatten = argv.flatten;

  let registry = argv.registry || process.env.npm_registry;
  const offline = !!argv.offline;
  // rebuild 优先用磁盘缓存中的 manifest 与 tgz, 缓存缺失时才联网
  const preferOffline = !!argv.rebuild && !offline;
  if (offline && !cacheDir) {
    console.error(
      chalk.red(
        'np ERROR --offline needs the disk cache, it can not be used with --no-cache, or --production without --cache-strict'
      )
    );
    process.exit(1);
  }
  // 未指定 registry 或指定的是 npmmirror / npmjs 时自动换源, 指定私有源时全部关闭; 指定公共源时跳过测速并以它优先
  const preferSource = registry ? mirror.sourceOf(registry) : null;
  const autoMirror = !registry || !!preferSource;
  // for env.npm_config_registry
  registry = registry || 'https://registry.npmjs.com';

  const env = {
    npm_config_registry: registry,
    // set npm_config_argv
    // see https://github.com/cnpm/npminstall/issues/121#issuecomment-247836741
    npm_config_argv: JSON.stringify({
      remain: [],
      cooked: originalArgv,
      original: originalArgv,
    }),
    // user-agent
    npm_config_user_agent: globalConfig.userAgent,
    // https://github.com/sass/node-sass/blob/master/lib/extensions.js#L270
    // make sure npm_config_cache env exists
    npm_config_cache: defaultCacheDir,
  };
  // https://github.com/npm/npm/blob/2005f4ce11f6cdf142f8a77f4f7ee4996000fb57/lib/utils/lifecycle.js#L67
  env.npm_node_execpath = env.NODE = process.env.NODE || process.execPath;
  // 固定为 np 命令入口: 经 np-x 分派时 require.main 是 x.js, 依赖脚本用 npm_execpath 执行 install 会被当作子命令解析
  env.npm_execpath = path.join(__dirname, '../../bin/i.js');

  // npm cli will auto set options to npm_xx env.
  for (const key in argv) {
    const value = argv[key];
    if (value && typeof value === 'string') {
      env['npm_config_' + key] = value;
    }
  }

  debug('argv: %j, env: %j', utils.redact(argv), utils.redact(env));

  const { workspaceRoots, workspacesMap } = await utils.readWorkspaces(root);
  // don't enable workspace on global install
  const enableWorkspace = !argv.global && workspacesMap.size > 0;
  if (enableWorkspace) {
    // 全局安装不能进入这里: forceSymlink 会先删除 root/node_modules 下同名的已有目录
    for (const info of workspacesMap.values()) {
      // link to root/node_modules
      const linkDir = path.join(root, 'node_modules', info.package.name);
      await utils.forceSymlink(info.root, linkDir);
      debug('add workspace %s on %s', info.package.name, info.root);
    }
  } else {
    installOnAllWorkspaces = false;
    installWorkspaceNames = [];
  }

  let binaryMirrors = {};
  let mirrorState;

  if (autoMirror) {
    // offline 与 rebuild 优先离线时不测速, 但仍按公共源处理, 使缓存键与在线时一致
    const probed =
      offline || preferOffline
        ? mirror.defaultOrder({ prefer: preferSource })
        : await mirror.probe({
            prefer: preferSource,
            globalOptions: { console },
            cacheDir: probeCacheDir,
            cacheMinutes: mirror.parseProbeCacheMinutes(argv['probe-cache'] ?? process.env.np_probe_cache),
          });
    binaryMirrors = probed.binaryMirrorConfig?.mirrors?.china;
    if (!binaryMirrors) {
      try {
        binaryMirrors = await utils.getBinaryMirrors(registry, { offline, preferOffline, cacheDir });
      } catch (err) {
        console.warn(chalk.yellow('np WARN load binary mirror config error: %s'), err.message);
        binaryMirrors = {};
      }
    }
    const binaryEnvs = { ...binaryMirrors.ENVS };
    mirrorState = mirror.create({ order: probed.order, binaryOrder: probed.binaryOrder, binaryEnvs });
    if (!preferSource) {
      registry = mirrorState.registry;
      env.npm_config_registry = registry;
    }
    if (probed.binaryOrder[0] === 'mirror') {
      Object.assign(env, binaryEnvs);
    }
    console.info(
      chalk.gray('np registry: %s, binary: %s%s'),
      probed.order.join(' > '),
      probed.binaryOrder.join(' > '),
      probed.cached ? ' (cached)' : ''
    );
  }

  const config = {
    root,
    registry,
    pkgs,
    production,
    cacheDir,
    refreshCache: argv['refresh-cache'],
    mirror: mirrorState,
    env,
    binaryMirrors,
    forbiddenLicenses,
    flatten,
    publicHoistPattern: argv.dedup ? '.*' : argv['public-hoist-pattern'],
    workspacesMap,
    // don't enable workspace on global install
    enableWorkspace,
    workspaceRoot: root,
    // install on one workspace package
    isWorkspacePackage: false,
    offline,
    preferOffline,
    deferPeerCheck: enableWorkspace,
    // 本次只安装部分依赖树, 已提升的链接只允许升级不允许降级
    partialInstall: pkgs.length > 0 || installWorkspaceNames.length > 0 || !!installOnAllWorkspaces,
  };
  // when ignore-scripts is set to `false` by user, np will still
  // get config from npm settings instead of following user's specification,
  // should migrate to ?? or typeof.
  // git 依赖构建的子安装: root 是克隆的仓库, 它的 allowScripts 与 npm 配置都不可信
  const gitPrepareChild = process.env[allowScripts.GIT_PREPARE_CHILD_ENV] === '1';
  config.ignoreScripts = gitPrepareChild || argv['ignore-scripts'] || getIgnoreScripts();
  config.scriptPolicy = gitPrepareChild
    ? allowScripts.empty()
    : allowScripts.load({ root, global: !!argv.global, argv });
  config.rebuild = argv.rebuild;
  config.foregroundScripts = argv['foreground-scripts'];
  config.ignoreOptionalDependencies = !argv.optional;
  config.detail = argv.detail;
  config.trace = argv.trace;
  config.engineStrict = argv['engine-strict'];
  config.legacyPeerDeps = argv['legacy-peer-deps'];
  config.registryOnly = argv['registry-only'];
  if (config.production || argv.global) {
    // make sure show detail on production install or global install
    config.detail = true;
  }
  config.client = argv.client;

  if (argv['tarball-url-mapping']) {
    const tarballUrlMapping = JSON.parse(argv['tarball-url-mapping']);
    config.formatNpmTarballUrl = function formatNpmTarballUrl(url) {
      for (const fromUrl in tarballUrlMapping) {
        const toUrl = tarballUrlMapping[fromUrl];
        url = url.replace(fromUrl, toUrl);
      }
      return url;
    };
  }

  if (argv['fix-bug-versions']) {
    const packageVersionMapping = await utils.getBugVersions(registry, { offline, preferOffline, cacheDir });
    config.autoFixVersion = function autoFixVersion(name, version) {
      const fixVersions = packageVersionMapping[name];
      return (fixVersions && fixVersions[version]) || null;
    };
  }

  const lockfilePath = argv['lockfile-path'];
  if (lockfilePath) {
    // 加载失败必须中止: 回退到联网解析会装出与 lockfile 不一致的版本且退出码为 0
    try {
      const lockfileData = await fs.readFile(lockfilePath, 'utf8');
      config.dependenciesTree = lockfileConverter(JSON.parse(lockfileData), {
        ignoreOptionalDependencies: true,
        onConflict(key, kept, ignored) {
          console.warn(
            chalk.yellow('np WARN %s is locked to both %s and %s in %s, installing %s everywhere'),
            key,
            kept,
            ignored,
            lockfilePath,
            kept
          );
        },
      });
    } catch (error) {
      throw new Error(`load lockfile from ${lockfilePath} error: ${error.message}`, { cause: error });
    }
  }

  const dependenciesTree = argv['dependencies-tree'];
  if (dependenciesTree) {
    try {
      const content = await fs.readFile(dependenciesTree);
      config.dependenciesTree = JSON.parse(content);
    } catch (err) {
      console.warn(chalk.yellow('np WARN load dependencies tree %s error: %s'), dependenciesTree, err.message);
    }
  }
  if (argv['save-dependencies-tree']) {
    config.saveDependenciesTree = true;
  }

  // 默认读写 <root>/np-lock.json; --lockfile-path, --dependencies-tree 与 -g 有各自的版本来源, 不使用它
  let lockState = null;
  const rootConfig = (await utils.readJSON(path.join(root, 'package.json'))).config?.np || {};
  const lockfileDisabled = argv.lockfile === false || ['0', 'false'].includes(process.env.np_lockfile);
  if (!argv.global && !lockfilePath && !dependenciesTree && !lockfileDisabled && rootConfig.lockfile !== false) {
    if (argv['frozen-lockfile'] && pkgs.length > 0 && !argv.rebuild && !argv['fetch-only']) {
      throw new Error(
        `--frozen-lockfile only installs from ${npLock.LOCKFILE_NAME}, it can not be used with package names`
      );
    }
    const lockExists = await npLock.exists(root);
    if (argv['frozen-lockfile'] && !lockExists) {
      throw new Error(`--frozen-lockfile requires ${npLock.LOCKFILE_NAME} in ${root}`);
    }
    if (lockExists || !(await npLock.hasForeignLockfile(root))) {
      const previous = lockExists ? await npLock.read(root) : {};
      // np-x update 要升级到范围内的最新版本, 不复用已锁定的版本
      config.dependenciesTree = ignoreLockfile ? {} : { ...previous };
      for (const pkg of pkgs) {
        if (isFloating(pkg)) delete config.dependenciesTree[npLock.keyOf(pkg.name, pkg.version)];
      }
      config.lockPackages = {};
      config.frozenLockfile = !!argv['frozen-lockfile'];
      lockState = { previous };
    }
  }

  process.on('exit', code => {
    if (code !== 0) {
      writeFileSync(path.join(root, 'np-debug.log'), util.inspect(utils.redact(config), { depth: 2 }));
    }
  });

  if (config.offline) {
    console.warn(chalk.yellow('np WARN running in offline mode'));
  }

  if (argv['fetch-only']) {
    if (argv.global || pkgs.length === 0 || installOnAllWorkspaces || installWorkspaceNames.length > 0) {
      throw new Error('np-x fetch needs at least one package and does not support -g, -w or --workspaces');
    }
    await fetchOnly(config, context);
    return;
  }

  if (argv.rebuild && pkgs.length > 0) {
    if (argv.global || installOnAllWorkspaces || installWorkspaceNames.length > 0) {
      throw new Error('np-x rebuild <pkg> does not support -g, -w or --workspaces');
    }
    config.rebuildSpecs = pkgs.map(pkg => {
      // 只接受包名与版本范围: <name>, <name>@<version>, <name>@<range>
      const bare = pkg.type === 'tag' && !pkg.arg.rawSpec;
      if (!pkg.name || (!bare && pkg.type !== 'version' && pkg.type !== 'range')) {
        throw new Error(`np-x rebuild only accepts <name>[@<version range>], got ${pkg.arg.raw}`);
      }
      return { raw: pkg.arg.raw, name: pkg.name, range: bare ? null : pkg.version };
    });
    config.env.npm_rootpath = process.env.npm_rootpath || root;
    config.env.INIT_CWD = process.env.INIT_CWD || root;
    await rebuild(config);
    return;
  }

  // -g install to npm's global prefix
  if (argv.global) {
    // support custom prefix for global install
    const meta = utils.getGlobalInstallMeta(argv.prefix);
    config.targetDir = meta.targetDir;
    config.binDir = meta.binDir;

    // package's npm script can get root from `env.npm_rootpath`
    config.env.npm_rootpath = process.env.npm_rootpath || root;
    config.env.INIT_CWD = process.env.INIT_CWD || root;
    await installGlobal(config, context);
    console.log('');
    return;
  }

  if (pkgs.length === 0) {
    if (config.production) {
      // warning when `${root}/node_modules` exists
      const nodeModulesDir = path.join(root, 'node_modules');
      if (await utils.exists(nodeModulesDir)) {
        const dirs = await fs.readdir(nodeModulesDir);
        // ignore [ '.bin', 'node' ], it will install first by https://github.com/cnpm/nodeinstall
        if (!(dirs.length === 2 && dirs.indexOf('.bin') >= 0 && dirs.indexOf('node') >= 0)) {
          console.error(chalk.yellow(`np WARN node_modules exists: ${nodeModulesDir}, contains ${dirs.length} dirs`));
        }
      }
    }
    if (!(await utils.exists(path.join(root, 'package.json')))) {
      console.warn(chalk.yellow(`np WARN package.json does not exist: ${path.join(root, 'package.json')}`));
    }
  }

  // package.json 的 config.np 对 `np` 与 `np <pkg>` 都生效, 命令行参数优先
  // { "config": { "np": { "publicHoistPattern": "eslint|prettier" } } }
  const npConfig = (await utils.readJSON(path.join(root, 'package.json'))).config?.np || {};
  if (!config.publicHoistPattern && typeof npConfig.publicHoistPattern === 'string') {
    config.publicHoistPattern = npConfig.publicHoistPattern;
  }

  const installRootConfigs = [];
  if (config.enableWorkspace) {
    if (installOnAllWorkspaces) {
      // npm i --workspaces
      for (const workspaceRoot of workspaceRoots) {
        installRootConfigs.push({
          ...config,
          root: workspaceRoot,
          isWorkspacePackage: true,
        });
      }
    } else if (installWorkspaceNames.length > 0) {
      // npm i --w foo
      const installWorkspaceInfos = await utils.getWorkspaceInfos(root, installWorkspaceNames, workspacesMap);
      if (installWorkspaceInfos.length === 0) {
        throw new Error(`No workspaces found: --workspace=${installWorkspaceNames.join(',')}`);
      }
      for (const { root: workspaceRoot } of installWorkspaceInfos) {
        installRootConfigs.push({
          ...config,
          root: workspaceRoot,
          isWorkspacePackage: true,
        });
      }
    } else {
      if (pkgs.length === 0) {
        // workspace: npm i
        for (const workspaceRoot of workspaceRoots) {
          installRootConfigs.push({
            ...config,
            root: workspaceRoot,
            isWorkspacePackage: true,
          });
        }
      }
      // workspace: npm i
      // workspace: npm i <name>
      installRootConfigs.push({
        ...config,
        root,
        isWorkspacePackage: false,
      });
    }
  } else {
    // normal: npm i
    // normal: npm i <name>
    installRootConfigs.push({
      ...config,
      root,
      isWorkspacePackage: false,
    });
  }

  // main installation logic
  // 一个 workspace 有包失败时继续安装其余 workspace, 最后统一汇总
  const failures = [];
  for (const installConfig of installRootConfigs) {
    installConfig.env.npm_rootpath = process.env.npm_rootpath || installConfig.root;
    installConfig.env.INIT_CWD = process.env.INIT_CWD || installConfig.root;
    try {
      await installLocal(installConfig, context);
    } catch (err) {
      if (err.code !== utils.INSTALL_FAILURES_CODE) throw err;
      failures.push(...err.failures);
      console.log('');
      continue;
    }
    console.log('');

    if (pkgs.length > 0) {
      // support --save, --save-dev, --save-optional, --save-client, --save-build and --save-isomorphic
      const map = {
        save: 'dependencies',
        'save-dev': 'devDependencies',
        'save-optional': 'optionalDependencies',
        'save-client': 'clientDependencies',
        'save-build': 'buildDependencies',
        'save-isomorphic': 'isomorphicDependencies',
      };
      const saved = [];
      // install saves any specified packages into dependencies by default.
      if (Object.keys(map).every(key => !argv[key]) && !argv['no-save']) {
        saved.push(
          ...(await updateDependencies(installConfig.root, pkgs, map.save, argv['save-exact'], installConfig))
        );
      } else {
        for (const key in map) {
          if (argv[key]) {
            saved.push(
              ...(await updateDependencies(installConfig.root, pkgs, map[key], argv['save-exact'], installConfig))
            );
          }
        }
      }
      if (lockState) relockRequested(lockState, config.lockPackages, pkgs, saved);
    }
  }
  await validatePendingPeerDependencies(context);
  if (failures.length > 0) throw utils.installFailuresError(failures);
  await writeLockfile(root, lockState, config, {
    full:
      pkgs.length === 0 &&
      !installOnAllWorkspaces &&
      installWorkspaceNames.length === 0 &&
      !config.production &&
      argv.optional !== false &&
      !argv.client,
  });
}

// 命令行显式写的 tag 与 `*`(含裸包名 `np foo`)每次取最新版本: 不复用锁定的版本, 也不写进锁文件
function isFloating(pkg) {
  const spec = pkg.type === ALIAS_TYPES ? pkg.arg.subSpec : pkg.arg;
  return spec.type === 'tag' || spec.rawSpec === '*';
}

// 命令行指定的包按命令行的写法解析并记锁, 改挂到保存进 package.json 的声明上, 之后的 np 与 --frozen-lockfile 才能按声明找到它
function relockRequested(lockState, lockPackages, pkgs, saved) {
  const targets = new Set();
  for (const { item, saveName, saveSpec } of saved) {
    const target = npLock.keyOf(saveName, saveSpec);
    const entry = item.lockKey && lockPackages[item.lockKey];
    if (!target || !entry) continue;
    lockPackages[target] = entry;
    targets.add(target);
  }
  for (const pkg of pkgs) {
    if (!pkg.lockKey || !isFloating(pkg) || targets.has(pkg.lockKey)) continue;
    delete lockPackages[pkg.lockKey];
    delete lockState.previous[pkg.lockKey];
  }
}

// 完整安装用本次实际用到的条目覆盖锁文件; 部分安装(指定包, -w, --workspaces, --production 等)只追加, 保留其余条目
async function writeLockfile(root, lockState, config, { full }) {
  if (!lockState || config.frozenLockfile) return;
  const packages = full ? config.lockPackages : { ...lockState.previous, ...config.lockPackages };
  if (await npLock.write(root, packages)) {
    console.info(chalk.gray('np %s updated'), npLock.LOCKFILE_NAME);
  }
}

let _versionSavePrefix = null;
function getVersionSavePrefix() {
  if (_versionSavePrefix === null) {
    try {
      _versionSavePrefix = execSync('npm config get save-prefix').toString().trim();
    } catch (err) {
      debug(`exec npm config get save-prefix ERROR: ${err.message}`);
      _versionSavePrefix = '^';
    }
  }
  return _versionSavePrefix;
}

function getIgnoreScripts() {
  try {
    const ignoreScripts = execSync('npm config get ignore-scripts').toString().trim();
    return ignoreScripts === 'true';
  } catch (err) {
    debug(`exec npm config get ignore-scripts ERROR: ${err.message}`);
    return false;
  }
}

// 返回 [{ item, saveName, saveSpec }]
async function updateDependencies(root, pkgs, propName, saveExact, options) {
  const pkgFile = path.join(root, 'package.json');
  const pkg = await utils.readJSON(pkgFile);
  const deps = (pkg[propName] = pkg[propName] || {});
  const saved = [];
  console.log('%s:', chalk.cyanBright(propName));
  for (const item of pkgs) {
    let saveName;
    let saveSpec;
    if (REMOTE_TYPES.includes(item.type)) {
      // if install from remote or git and don't specified name
      // get package's name from `remoteNames`
      if (item.name) {
        saveName = item.name;
        saveSpec = item.version;
      } else {
        saveName = options.remoteNames[item.version];
        saveSpec = item.version;
      }
    } else if (item.type === ALIAS_TYPES) {
      saveName = item.name;
      saveSpec = item.version;
    } else {
      let saveVersion;
      if (item.workspacePackage) {
        saveName = item.workspacePackage.name;
        saveVersion = item.workspacePackage.version || item.version;
      } else if (LOCAL_TYPES.includes(item.type)) {
        const itemPkg = await utils.readJSON(path.join(item.version, 'package.json'));
        saveName = itemPkg.name;
        saveVersion = itemPkg.version;
      } else {
        // 磁盘上的 package.json 来自 tarball, 可能自称其他包: 按依赖名保存, 版本取 registry 的解析结果
        const resolved =
          options.cache.dependenciesTree[item.lockKey] ||
          (await utils.readJSON(path.join(root, 'node_modules', item.name, 'package.json')));
        saveName = item.name;
        saveVersion = resolved.version;
      }
      // If install with `np foo`, the type is tag but rawSpec is empty string
      if (item.arg.type === 'tag' && item.arg.rawSpec) {
        saveSpec = item.arg.rawSpec;
      } else {
        const savePrefix = saveExact ? '' : getVersionSavePrefix();
        saveSpec = `${savePrefix}${saveVersion}`;
      }
    }
    deps[saveName] = saveSpec;
    saved.push({ item, saveName, saveSpec });
    console.log('%s %s %s', chalk.green('+'), chalk.bold(saveName), chalk.gray(saveSpec));
  }
  console.log('');
  // sort pkg[propName]
  const newDeps = {};
  for (const key of Object.keys(deps).sort()) {
    newDeps[key] = deps[key];
  }
  pkg[propName] = newDeps;
  await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  return saved;
}
