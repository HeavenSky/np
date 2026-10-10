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
const foreignConfig = require('../foreign_config');
const npConfig = require('../np_config');
const help = require('./help');
const cliProfile = require('./profile');

// 命令行未出现时删掉 minimist 补的默认 false, 否则会盖过环境变量与 ~/.nprc, 例如未传 --strict-ssl 也关闭证书校验
const TRI_STATE_FLAGS = ['strict-ssl', 'strict-allow-scripts', 'dangerously-allow-all-scripts', 'lockfile'];
// 可以重复传入的参数, 其余参数重复时与 npm 一致取最后一个
const MULTI_VALUE_ARGS = new Set(['_', 'allow-scripts', 'only', 'include', 'omit', 'exclude']);
// 已移除的参数报错而不是忽略: 未声明的开关会把紧跟其后的包名当作自己的值吞掉, 安装结果静默改变
const REMOVED_ARGS = {
  save: 'packages are saved to dependencies by default',
  'save-dev': 'use --write=dev',
  'save-optional': 'use --write=optional',
  'save-exact': 'use --write-exact',
  'save-client': 'use --write=client',
  'save-build': 'use --write=build',
  'save-isomorphic': 'use --write=isomorphic',
  'save-deps': 'use --write=<type>',
  client: 'use --only=client,build,isomorphic',
  'with-deps': 'use --include=<type>',
  optional: 'use --omit=optional',
  'legacy-peer-deps': 'use --omit=peer',
  'cache-strict': '--production no longer turns off the disk cache, use --no-cache to turn it off',
  'dependencies-tree': 'np-lock.json records the resolved versions',
  'save-dependencies-tree': 'np-lock.json records the resolved versions',
  'lockfile-path': 'use --from-package-lock',
  'fetch-only': 'use np-x fetch',
  rebuild: 'use np-x rebuild',
  root: 'run np in that folder instead',
  workspace: 'run np inside the workspace folder instead',
  dedup: 'use --shamefully-hoist',
  flatten: 'it is no longer supported',
  'fix-bug-versions': 'it is no longer supported',
  'tarball-url-mapping': 'it is no longer supported',
  china: 'public registries and binary mirrors switch automatically by speed',
  'custom-china-mirror-url': 'binary mirrors switch automatically by speed',
  prune: 'it silently broke packages such as @tsconfig/*',
  'force-link-latest': 'the latest version is always linked',
  'disable-fallback-store': 'fallback links in node_modules/.store/node_modules are always created',
};
const REMOVED_SHORT_ARGS = {
  S: 'packages are saved to dependencies by default',
  D: 'use --write=dev',
  O: 'use --write=optional',
  E: 'use --write-exact',
  d: 'use --detail',
  w: 'run np inside the workspace folder instead',
  c: 'public registries and binary mirrors switch automatically by speed',
};
// <type> 的格式, 对应 package.json 的 <type>Dependencies 字段
const DEP_TYPE = /^[a-z][a-zA-Z0-9]*$/;
// 内置类型的字段名, 其他 <type> 对应 <type>Dependencies
const TYPE_FIELDS = {
  prod: 'dependencies',
  dev: 'devDependencies',
  optional: 'optionalDependencies',
  peer: 'peerDependencies',
};
const fieldOf = type => TYPE_FIELDS[type] || `${type}Dependencies`;
// 不传 --only 时安装的类型
const DEFAULT_TYPES = ['prod', 'dev', 'optional'];
// npm 定义的依赖字段, 其余 <type>Dependencies 字段只在 --only / --include 列出时安装
const STANDARD_DEP_FIELDS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
]);

// mode: install, 或由 np-x fetch / np-x rebuild 转入的 fetch, rebuild
module.exports = async function install(
  args,
  { ignorePkgNames = false, ignoreLockfile = false, mode = 'install' } = {}
) {
  try {
    await main(args, { ignorePkgNames, ignoreLockfile, mode });
  } catch (err) {
    utils.exitWithError('np', err);
  }
};

async function main(args, { ignorePkgNames = false, ignoreLockfile = false, mode = 'install' } = {}) {
  const originalArgv = args;

  // since minimist consider --no-xx is xx:false, we handle it manually here
  // --no-write 与 --no-save 相同
  const argv = { 'no-save': originalArgv.includes('--no-save') || originalArgv.includes('--no-write') };
  Object.assign(
    argv,
    parseArgs(originalArgv, {
      string: [
        'registry',
        'prefix',
        'forbidden-licenses',
        'proxy',
        'https-proxy',
        'noproxy',
        'cafile',
        'allow-scripts',
        // np --only=prod, np --only=client,build: 只安装这些类型对应的字段
        'only',
        // np --include=client: 另外安装 clientDependencies
        'include',
        // np --omit=dev, --exclude 与它相同
        'omit',
        'exclude',
        // np foo --write=dev: 保存到 devDependencies
        'write',
        // 按 package-lock.json(lockfileVersion >= 2)中锁定的版本安装, 其中的 optionalDependencies 被忽略
        'from-package-lock',
        'probe-cache',
        'public-hoist-pattern',
      ],
      boolean: [
        'version',
        'help',
        'production',
        'prod',
        'global',
        // Saved dependencies will be configured with an exact version rather than using npm's default semver range operator.
        'write-exact',
        'ignore-scripts',
        // run scripts on foreground, default is background
        'foreground-scripts',
        'detail',
        'trace',
        'engine-strict',
        'registry-only',
        'prefer-offline',
        // --prune 已移除: 按固定名单跳过解压文件会误删 tsconfig.json 等运行时文件
        // --force-link-latest 已移除: 提升到根目录时始终链接最高版本
        'shamefully-hoist',
        'workspaces',
        'offline',
        'refresh-cache',
        'frozen-lockfile',
        ...TRI_STATE_FLAGS,
      ],
      alias: {
        v: 'version',
        h: 'help',
        g: 'global',
        r: 'registry',
        ws: 'workspaces',
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
  for (const [name, hint] of Object.entries(REMOVED_ARGS)) {
    // --no-save 仍然有效, 只拒绝 --save
    const negated = name !== 'save';
    if (
      flagArgs.some(arg => arg === `--${name}` || (negated && arg === `--no-${name}`) || arg.startsWith(`--${name}=`))
    ) {
      throw new Error(`--${name} has been removed, ${hint}`);
    }
  }
  for (const arg of flagArgs.filter(arg => /^-[^-]/.test(arg))) {
    const letter = [...arg.slice(1).split('=')[0]].find(letter => REMOVED_SHORT_ARGS[letter]);
    if (letter) throw new Error(`-${letter} has been removed, ${REMOVED_SHORT_ARGS[letter]}`);
  }
  // np foo --write dev 也能解析, 但 np foo --write bar 会把包名 bar 当作类型吞掉, 只接受 --write=<type>
  if (flagArgs.includes('--write')) throw new Error('--write only accepts the --write=<type> form, e.g. --write=dev');

  // np 补上 --no-lockfile 与 --dangerously-allow-all-scripts; 命令行给出了同名参数或 --frozen-lockfile 时不补
  for (const [name, value] of Object.entries(cliProfile.defaultArgs())) {
    if (argv[name] !== undefined || (name === 'lockfile' && argv['frozen-lockfile'])) continue;
    argv[name] = value;
  }

  if (argv.version) {
    console.log(`np v${require('../../package.json').version}`);
    process.exit(0);
  }

  if (argv.help) {
    console.log(mode === 'fetch' ? help.fetch() : mode === 'rebuild' ? help.rebuild() : help.install());
    process.exit(0);
  }

  const only = parseDepTypes(argv.only, '--only');
  if (argv.prod) only.push('prod');
  const include = parseDepTypes(argv.include, '--include');
  const omit = parseDepTypes([].concat(argv.omit ?? [], argv.exclude ?? []), '--omit');
  // 只在没有 --only 时生效: --production 与 NODE_ENV=production 省略 dev, --omit=optional / peer 作用到整棵依赖树
  if (only.length === 0 && (argv.production || process.env.NODE_ENV === 'production')) omit.push('dev');
  // 同时出现在 --include 与 --omit 中的类型照常安装
  const omitted = new Set(omit.filter(type => !include.includes(type)));
  const installTypes = [...new Set([...(only.length ? only : DEFAULT_TYPES), ...include])].filter(
    type => !omitted.has(type)
  );
  const rootFields = installTypes.map(fieldOf);
  const omitTreeOptional = only.length === 0 && omitted.has('optional');
  const omitPeers = only.length === 0 && omitted.has('peer');
  // minimist 把 --no-write 解析为 write: false, 它只表示不保存
  const write = argv.write === undefined || argv.write === false ? null : parseDepTypes(argv.write, '--write');
  if (write && write.length !== 1) throw new Error('--write takes one type, e.g. --write=dev');
  if (write && argv._.length === 0) throw new Error('--write needs package names, e.g. np foo --write=dev');

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
    const p = npa(name, { nested: context.nested });
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

  // 在 workspace 目录中运行时以上层项目为根, 只处理这个 workspace
  const { root, workspaceName: cwdWorkspace } = argv.global
    ? { root: process.cwd(), workspaceName: null }
    : await utils.resolveProjectRoot();
  // pnpm-workspace.yaml 与 package.json 的 pnpm 字段; 全局安装没有项目配置
  const pnpmSettings = !argv.global ? foreignConfig.pnpm(root) : {};
  let installOnAllWorkspaces = argv.workspaces;
  // fetch 与 rebuild 作用于整个项目, 不按当前 workspace 限定
  let installWorkspaceNames = cwdWorkspace && !installOnAllWorkspaces && mode === 'install' ? [cwdWorkspace] : [];
  const production = !installTypes.includes('dev');
  // support npm_config_cache to change default cache dir
  const defaultCacheDir = process.env.npm_config_cache || path.join(os.homedir(), '.np_tarball');
  let cacheDir = defaultCacheDir;
  if (argv.cache === false) {
    cacheDir = '';
  }
  // --no-cache 优先于 np_cache
  if (process.env.np_cache && argv.cache !== false) {
    cacheDir = process.env.np_cache;
  }
  // 测速缓存与磁盘缓存一样只在 --no-cache 时停用, 位置同样跟随 np_cache
  const probeCacheDir = argv.cache === false ? '' : process.env.np_cache || defaultCacheDir;

  let forbiddenLicenses = argv['forbidden-licenses'];
  forbiddenLicenses = forbiddenLicenses ? forbiddenLicenses.split(',') : null;

  // --registry > npm_registry > ~/.nprc > .npmrc
  let registry = argv.registry || process.env.npm_registry || npConfig.get('registry') || foreignConfig.registry();
  const offline = !!argv.offline;
  // rebuild 优先用磁盘缓存中的 manifest 与 tgz, 缓存缺失时才联网
  const preferOffline = (mode === 'rebuild' || !!argv['prefer-offline']) && !offline;
  if (offline && !cacheDir) {
    console.error(chalk.red('np ERROR --offline needs the disk cache, it can not be used with --no-cache'));
    process.exit(1);
  }
  // 未指定 registry 或指定的是 5 个公共源之一时自动换源, 指定私有源时全部关闭; 指定公共源时它排第一, 其余名次仍按测速
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
    publicHoistPattern: argv['shamefully-hoist'] ? '.*' : argv['public-hoist-pattern'],
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
    : allowScripts.load({ root, global: !!argv.global, argv, pnpm: pnpmSettings });
  config.rebuild = mode === 'rebuild';
  config.foregroundScripts = argv['foreground-scripts'];
  config.ignoreOptionalDependencies = omitTreeOptional;
  config.detail = argv.detail;
  config.trace = argv.trace;
  config.engineStrict = argv['engine-strict'];
  config.legacyPeerDeps = omitPeers;
  config.registryOnly = argv['registry-only'];
  if (argv.global) {
    // make sure show detail on global install
    config.detail = true;
  }
  config.rootFields = rootFields;

  const lockfilePath = argv['from-package-lock'];
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

  // 默认读写 <root>/np-lock.json; --from-package-lock 与 -g 有各自的版本来源, 不使用它
  let lockState = null;
  const rootConfig = (await utils.readJSON(path.join(root, 'package.json'))).config?.np || {};
  // 取第一个有配置的来源: --lockfile / --no-lockfile > --frozen-lockfile > 环境变量 np_lockfile > config.np.lockfile > npm 与 pnpm 配置; np 入口的 --no-lockfile 已作为命令行参数传入
  const lockfileEnabled =
    [
      argv.lockfile,
      argv['frozen-lockfile'] || undefined,
      foreignConfig.toBool(process.env.np_lockfile),
      rootConfig.lockfile,
      foreignConfig.lockfile(pnpmSettings),
    ].find(value => typeof value === 'boolean') ?? true;
  if (!argv.global && !lockfilePath && lockfileEnabled) {
    if (argv['frozen-lockfile'] && pkgs.length > 0 && mode === 'install') {
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

  if (mode === 'fetch') {
    if (argv.global || pkgs.length === 0 || installOnAllWorkspaces || installWorkspaceNames.length > 0) {
      throw new Error('np-x fetch needs at least one package and does not support -g or --workspaces');
    }
    await fetchOnly(config, context);
    return;
  }

  if (mode === 'rebuild' && pkgs.length > 0) {
    if (argv.global || installOnAllWorkspaces || installWorkspaceNames.length > 0) {
      throw new Error('np-x rebuild <pkg> does not support -g or --workspaces');
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
  const rootPkgJson = await utils.readJSON(path.join(root, 'package.json'));
  const pkgNpConfig = rootPkgJson.config?.np || {};
  // np --only foo 会把本想安装的包名 foo 当作类型: 自定义类型在根项目与各 workspace 中都没有对应字段时报错
  if (pkgs.length === 0) {
    const declaring = [rootPkgJson, ...[...workspacesMap.values()].map(info => info.package)];
    for (const type of new Set([...only, ...include, ...omit])) {
      if (TYPE_FIELDS[type] || declaring.some(pkg => pkg[fieldOf(type)])) continue;
      throw new Error(`no ${fieldOf(type)} in package.json for type "${type}"`);
    }
  }
  // 只在没有 --only 的完整安装时提示; 有跳过的字段时锁文件按部分安装只追加, 保留用 --include 安装时记下的条目
  const skippedDepFields = pkgs.length === 0 && only.length === 0 ? getSkippedDepFields(rootPkgJson, rootFields) : [];
  if (skippedDepFields.length > 0) {
    const types = skippedDepFields.map(field => field.replace(/Dependencies$/, ''));
    console.warn(
      chalk.yellow('np WARN %s in package.json are not installed, pass --include=%s to install them'),
      skippedDepFields.join(', '),
      types.join(',')
    );
  }
  if (!config.publicHoistPattern && typeof pkgNpConfig.publicHoistPattern === 'string') {
    config.publicHoistPattern = pkgNpConfig.publicHoistPattern;
  }
  // 再读 pnpm 的 shamefullyHoist / publicHoistPattern 与 .npmrc 的同名设置, glob 转成正则
  if (!config.publicHoistPattern) {
    config.publicHoistPattern = foreignConfig.publicHoistPattern(pnpmSettings);
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
      // 默认保存到 dependencies, --write=<type> 保存到对应字段, --no-save 不修改 package.json
      const field = write ? fieldOf(write[0]) : 'dependencies';
      const saved = argv['no-save']
        ? []
        : await updateDependencies(installConfig.root, pkgs, field, argv['write-exact'], installConfig);
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
      only.length === 0 &&
      omitted.size === 0 &&
      skippedDepFields.length === 0,
  });
}

// 逗号分隔且可重复传入的依赖类型名; 校验格式, 防止把包名或路径当作类型
function parseDepTypes(value, flag) {
  const types = []
    .concat(value ?? [])
    .flatMap(item => String(item).split(','))
    .map(item => item.trim())
    .filter(Boolean);
  for (const type of types) {
    if (!DEP_TYPE.test(type)) throw new Error(`${flag} takes dependency types like client or build, got "${type}"`);
  }
  return [...new Set(types)];
}

// package.json 中声明了但本次不安装的非标准依赖字段, 如未传 --include=client 时的 clientDependencies
function getSkippedDepFields(pkg, rootFields) {
  return Object.keys(pkg).filter(
    field =>
      /^[a-z][a-zA-Z0-9]*Dependencies$/.test(field) &&
      !STANDARD_DEP_FIELDS.has(field) &&
      !rootFields.includes(field) &&
      pkg[field] &&
      typeof pkg[field] === 'object' &&
      Object.keys(pkg[field]).length > 0
  );
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

const NPM_CONFIG_TIMEOUT = 30 * 1000;
let _versionSavePrefix = null;
function getVersionSavePrefix() {
  if (_versionSavePrefix === null) {
    try {
      _versionSavePrefix = execSync('npm config get save-prefix', {
        timeout: NPM_CONFIG_TIMEOUT,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
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
