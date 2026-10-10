'use strict';

const debug = require('debug')('npd:cli:install');
const chalk = require('chalk');
const path = require('path');
const os = require('os');
const util = require('util');
const { execSync } = require('child_process');
const fs = require('fs/promises');
const { writeFileSync } = require('fs');
const parseArgs = require('minimist');
const { installLocal, installGlobal, fetchOnly, rebuild } = require('..');
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
const cliProfile = require('./profile');
const { PREPARE_CHILD_ENV } = require('../download/git');
const help = require('./help');

// 三态开关: 命令行开 / 关, 未传时由环境变量与 ~/.nprc 决定
const TRISTATE_FLAGS = ['dangerously-allow-all-scripts', 'strict-allow-scripts', 'strict-ssl', 'lockfile'];
// 可重复传入且各项合并的参数; 其余参数重复传入时与 npm 一致取最后一个
const MULTI_VALUE_FLAGS = ['allow-scripts', 'only', 'include', 'omit', 'exclude'];
// 已移除的参数报错而不是忽略: 未声明的开关会把紧跟其后的包名当作自己的值吞掉, 安装结果静默改变
const REMOVED_FLAGS = {
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
  'fetch-only': 'use npd-x fetch',
  rebuild: 'use npd-x rebuild',
  root: 'run npd in that folder instead',
  flatten: 'it is no longer supported',
  'fix-bug-versions': 'it is no longer supported',
  'tarball-url-mapping': 'it is no longer supported',
  'high-speed-store': 'it is no longer supported',
  china: 'public registries and binary mirrors switch automatically by speed',
  'custom-china-mirror-url': 'binary mirrors switch automatically by speed',
  prune: 'it silently broke packages such as @tsconfig/*',
  'force-link-latest': 'the latest version is always linked',
  'disable-dedupe': 'the latest version of every package is always linked into node_modules',
};
const REMOVED_SHORT_FLAGS = {
  S: 'packages are saved to dependencies by default',
  D: 'use --write=dev',
  O: 'use --write=optional',
  E: 'use --write-exact',
  d: 'use --detail',
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

// mode: install, 或由 npd-x fetch / npd-x rebuild 转入的 fetch, rebuild
module.exports = async function install(
  args,
  { ignorePkgNames = false, ignoreLockfile = false, mode = 'install' } = {}
) {
  try {
    await main(args, { ignorePkgNames, ignoreLockfile, mode });
  } catch (err) {
    utils.exitWithError('npd', err);
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
        // 依赖脚本放行名单, 可重复传入
        'allow-scripts',
        // npd --only=prod, npd --only=client,build: 只安装这些类型对应的字段
        'only',
        // npd --include=client: 另外安装 clientDependencies
        'include',
        // npd --omit=dev, --exclude 与它相同
        'omit',
        'exclude',
        // npd foo --write=dev: 保存到 devDependencies
        'write',
        // 按 package-lock.json(lockfileVersion >= 2)中锁定的版本安装, 其中的 optionalDependencies 被忽略
        'from-package-lock',
        'probe-cache',
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
        'detail',
        'trace',
        'engine-strict',
        'registry-only',
        'prefer-offline',
        // --prune 已移除: 按固定名单跳过解压文件会误删 tsconfig.json 等运行时文件
        'refresh-cache',
        'frozen-lockfile',
        'offline',
        // run scripts on foreground, default is background
        'foreground-scripts',
        ...TRISTATE_FLAGS,
        // --force-link-latest 已移除: 提升到根目录时始终链接最高版本
      ],
      alias: {
        v: 'version',
        h: 'help',
        g: 'global',
        r: 'registry',
      },
    })
  );

  dropUnsetFlags(argv, originalArgv);
  for (const key of Object.keys(argv)) {
    if (key !== '_' && !MULTI_VALUE_FLAGS.includes(key) && Array.isArray(argv[key])) {
      argv[key] = argv[key][argv[key].length - 1];
    }
  }
  const end = originalArgv.indexOf('--');
  const flagArgs = end === -1 ? originalArgv : originalArgv.slice(0, end);
  for (const [name, hint] of Object.entries(REMOVED_FLAGS)) {
    // --no-save 仍然有效, 只有 --save 被移除
    const negated = name === 'save' ? null : `--no-${name}`;
    if (flagArgs.some(arg => arg === `--${name}` || arg === negated || arg.startsWith(`--${name}=`))) {
      throw new Error(`--${name} has been removed, ${hint}`);
    }
  }
  for (const arg of flagArgs.filter(arg => /^-[^-]/.test(arg))) {
    const letter = [...arg.slice(1).split('=')[0]].find(letter => REMOVED_SHORT_FLAGS[letter]);
    if (letter) throw new Error(`-${letter} has been removed, ${REMOVED_SHORT_FLAGS[letter]}`);
  }
  // npd foo --write dev 也能解析, 但 npd foo --write bar 会把包名 bar 当作类型吞掉, 只接受 --write=<type>
  if (flagArgs.includes('--write')) throw new Error('--write only accepts the --write=<type> form, e.g. --write=dev');

  // npd 补上 --no-lockfile 与 --dangerously-allow-all-scripts; 命令行给出了同名参数或 --frozen-lockfile 时不补
  for (const [name, value] of Object.entries(cliProfile.defaultArgs())) {
    if (argv[name] !== undefined || (name === 'lockfile' && argv['frozen-lockfile'])) continue;
    argv[name] = value;
  }

  if (argv.version) {
    console.log(`npd v${require('../../package.json').version}`);
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
  if (write && argv._.length === 0) throw new Error('--write needs package names, e.g. npd foo --write=dev');

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
    // `mozilla/nunjucks#0f8b21b8df7e8e852b2e1889388653b7075f0d09` should be rawSpec
    // `npd foo` 未写版本时 npa 补成 latest tag, 改传 `*` 以便选版时与显式的 `foo@latest` 区分并检查 engines
    const version = p.type === 'tag' && !p.rawSpec ? '*' : p.fetchSpec || p.rawSpec;
    const spec = p.type === ALIAS_TYPES ? p.subSpec : p;
    pkgs.push({
      // alias 与 package.json 里的声明一样拆成真实包名与版本(dependencies.js), 安装时记录的锁键才与 npLock.keyOf 一致
      name: spec.name,
      version: p.type === ALIAS_TYPES ? spec.fetchSpec : version,
      type: p.type,
      alias: aliasPackageName,
      arg: p,
      lockKey: cliLockKey(p, version),
      // 命令行显式写的 tag 与 * 要取最新版本: 不复用锁文件, 也不把这个键写进锁文件
      floating: spec.type === 'tag' || spec.fetchSpec === '*',
    });
  }
  if (argv['frozen-lockfile'] && pkgs.length > 0 && !argv.global && mode === 'install') {
    throw new Error('--frozen-lockfile can not be used with package arguments, they would change np-lock.json');
  }

  const root = process.cwd();
  // pnpm-workspace.yaml 与 package.json 的 pnpm 字段; 全局安装没有项目配置
  const pnpmSettings = !argv.global ? foreignConfig.pnpm(root) : {};
  const production = !installTypes.includes('dev');
  let cacheDir = argv.cache === false ? '' : null;
  // support npm_config_cache to change default cache dir
  if (cacheDir === null && process.env.npm_config_cache) {
    cacheDir = process.env.npm_config_cache;
  }
  // --no-cache 优先于 np_cache
  if (process.env.np_cache && argv.cache !== false) {
    cacheDir = process.env.np_cache;
  }
  // 测速缓存与磁盘缓存一样只在 --no-cache 时停用
  const probeCacheDir =
    argv.cache === false
      ? ''
      : process.env.np_cache || process.env.npm_config_cache || path.join(os.homedir(), '.np_tarball');
  const offline = !!argv.offline;
  // rebuild 优先用磁盘缓存中的 manifest 与 tgz, 缓存缺失时才联网
  const preferOffline = (mode === 'rebuild' || !!argv['prefer-offline']) && !offline;
  if (offline && cacheDir === '') {
    console.error(chalk.red('npd ERROR --offline needs the disk cache, it can not be used with --no-cache'));
    process.exit(1);
  }

  let forbiddenLicenses = argv['forbidden-licenses'];
  forbiddenLicenses = forbiddenLicenses ? forbiddenLicenses.split(',') : null;

  // --registry > npm_registry > ~/.nprc > .npmrc
  let registry = argv.registry || process.env.npm_registry || npConfig.get('registry') || foreignConfig.registry();
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
  };
  // https://github.com/npm/npm/blob/2005f4ce11f6cdf142f8a77f4f7ee4996000fb57/lib/utils/lifecycle.js#L67
  env.npm_node_execpath = env.NODE = process.env.NODE || process.execPath;
  // 固定为 npd 命令入口: 经 npd-x 分派时 require.main 是 x.js, 依赖脚本用 npm_execpath 执行 install 会被当作子命令解析
  env.npm_execpath = path.join(__dirname, '../../bin/i.js');

  // package's npm script can get root from `env.npm_rootpath`
  env.npm_rootpath = process.env.npm_rootpath || root;

  // npm cli will auto set options to npm_xx env.
  for (const key in argv) {
    const value = argv[key];
    if (value && typeof value === 'string') {
      env['npm_config_' + key] = value;
    }
  }

  debug('argv: %j, env: %j', utils.redact(argv), utils.redact(env));

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
        binaryMirrors = await utils.getBinaryMirrors(registry, { offline, preferOffline });
      } catch (err) {
        console.warn(chalk.yellow('npd WARN load binary mirror config error: %s'), err.message);
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
      chalk.gray('npd registry: %s, binary: %s%s'),
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
    offline,
    preferOffline,
    mirror: mirrorState,
    env,
    binaryMirrors,
    forbiddenLicenses,
  };
  const gitPrepareChild = process.env[PREPARE_CHILD_ENV] === '1';
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

  process.on('exit', code => {
    if (code !== 0) {
      writeFileSync(path.join(root, 'npd-debug.log'), util.inspect(utils.redact(config), { depth: 2 }));
    }
  });

  const lockfilePath = argv['from-package-lock'];
  if (lockfilePath) {
    // 加载失败必须中止: 回退到联网解析会装出与 lockfile 不一致的版本且退出码为 0
    try {
      const lockfileData = await fs.readFile(lockfilePath, 'utf8');
      config.dependenciesTree = lockfileConverter(JSON.parse(lockfileData), {
        ignoreOptionalDependencies: true,
      });
    } catch (error) {
      throw new Error(`load lockfile from ${lockfilePath} error: ${error.message}`, { cause: error });
    }
  }

  // 默认读写 <root>/np-lock.json; --from-package-lock 与 -g 有各自的版本来源, 不使用它
  let lockState = null;
  // 与 easy-np 共用同一份锁文件, 开关也读同一个 config.np.lockfile
  const rootPkg = await utils.readJSON(path.join(root, 'package.json'));
  const rootConfig = rootPkg.config?.np || {};
  // 取第一个有配置的来源: --lockfile / --no-lockfile > --frozen-lockfile > 环境变量 np_lockfile > config.np.lockfile > npm 与 pnpm 配置; npd 入口的 --no-lockfile 已作为命令行参数传入
  const lockfileEnabled =
    [
      argv.lockfile,
      argv['frozen-lockfile'] || undefined,
      foreignConfig.toBool(process.env.np_lockfile),
      rootConfig.lockfile,
      foreignConfig.lockfile(pnpmSettings),
    ].find(value => typeof value === 'boolean') ?? true;
  if (!argv.global && !lockfilePath && lockfileEnabled) {
    const lockExists = await npLock.exists(root);
    if (argv['frozen-lockfile'] && !lockExists) {
      throw new Error(`--frozen-lockfile requires ${npLock.LOCKFILE_NAME} in ${root}`);
    }
    if (lockExists || !(await npLock.hasForeignLockfile(root))) {
      const previous = lockExists ? await npLock.read(root) : {};
      // npd-x update 要升级到范围内的最新版本, 不复用已锁定的版本
      config.dependenciesTree = ignoreLockfile ? {} : { ...previous };
      for (const pkg of pkgs) {
        if (pkg.floating && pkg.lockKey) delete config.dependenciesTree[pkg.lockKey];
      }
      config.lockPackages = {};
      config.frozenLockfile = !!argv['frozen-lockfile'];
      // 锁文件与 easy-np 共用, easy-np 在 workspace 根记录全部成员的依赖; 按完整安装覆盖会删掉它们
      // np-x 还把 pnpm-workspace.yaml 的 packages 当作 workspaces, 这里不论入口都要识别
      const pnpmPackages = foreignConfig.pnpm(root).packages;
      lockState = {
        previous,
        workspaces: !!rootPkg.workspaces || (Array.isArray(pnpmPackages) && pnpmPackages.length > 0),
      };
    }
  }
  if (rootPkg.workspaces && !argv.global) {
    console.warn(
      chalk.yellow('npd WARN workspaces are not supported, only dependencies of %s are installed'),
      path.join(root, 'package.json')
    );
  }

  if (mode === 'fetch') {
    if (argv.global || pkgs.length === 0) {
      throw new Error('npd-x fetch needs at least one package and does not support -g');
    }
    await fetchOnly(config, context);
    return;
  }

  if (mode === 'rebuild' && pkgs.length > 0) {
    if (argv.global) {
      throw new Error('npd-x rebuild <pkg> does not support -g');
    }
    config.rebuildSpecs = pkgs.map(pkg => {
      // 只接受包名与版本范围: <name>, <name>@<version>, <name>@<range>
      const bare = pkg.type === 'tag' && !pkg.arg.rawSpec;
      if (!pkg.name || (!bare && pkg.type !== 'version' && pkg.type !== 'range')) {
        throw new Error(`npd-x rebuild only accepts <name>[@<version range>], got ${pkg.arg.raw}`);
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
    await installGlobal(config, context);
  } else {
    if (pkgs.length === 0) {
      if (config.production) {
        // warning when `${root}/node_modules` exists
        const nodeModulesDir = path.join(root, 'node_modules');
        if (await utils.exists(nodeModulesDir)) {
          const dirs = await fs.readdir(nodeModulesDir);
          // ignore [ '.bin', 'node' ], it will install first by https://github.com/cnpm/nodeinstall
          if (!(dirs.length === 2 && dirs.indexOf('.bin') >= 0 && dirs.indexOf('node') >= 0)) {
            console.error(
              chalk.yellow(`npd WARN node_modules exists: ${nodeModulesDir}, contains ${dirs.length} dirs`)
            );
          }
        }
      }
      const pkgFile = path.join(root, 'package.json');
      const exists = await utils.exists(pkgFile);
      if (!exists) {
        console.warn(chalk.yellow(`npd WARN package.json does not exist: ${pkgFile}`));
      }
    }
    // npd --only foo 会把本想安装的包名 foo 当作类型: 自定义类型在 package.json 中没有对应字段时报错
    if (pkgs.length === 0) {
      for (const type of new Set([...only, ...include, ...omit])) {
        if (!TYPE_FIELDS[type] && !rootPkg[fieldOf(type)]) {
          throw new Error(`no ${fieldOf(type)} in package.json for type "${type}"`);
        }
      }
    }
    // 只在没有 --only 的完整安装时提示; 有跳过的字段时锁文件按部分安装只追加, 保留用 --include 安装时记下的条目
    const skippedDepFields = pkgs.length === 0 && only.length === 0 ? getSkippedDepFields(rootPkg, rootFields) : [];
    if (skippedDepFields.length > 0) {
      console.warn(
        chalk.yellow('npd WARN %s in package.json are not installed, pass --include=%s to install them'),
        skippedDepFields.join(', '),
        skippedDepFields.map(field => field.replace(/Dependencies$/, '')).join(',')
      );
    }
    await installLocal(config, context);
    const saved = [];
    // 默认保存到 dependencies, --write=<type> 保存到对应字段, --no-save 不修改 package.json
    if (pkgs.length > 0 && !argv['no-save']) {
      const field = write ? fieldOf(write[0]) : 'dependencies';
      saved.push(...(await updateDependencies(root, pkgs, field, argv['write-exact'], config.remoteNames)));
    }
    relockSavedPackages(lockState, config, pkgs, saved);
    await writeLockfile(root, lockState, config, {
      full: pkgs.length === 0 && only.length === 0 && omitted.size === 0 && skippedDepFields.length === 0,
    });
  }
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

// 必须等于安装时记录锁文件条目所用的键, 否则保存后改挂锁键时静默找不到条目
function cliLockKey(p, version) {
  if (LOCAL_TYPES.includes(p.type)) return null;
  if (!p.name) return version;
  if (p.type === ALIAS_TYPES) return npLock.keyOf(p.name, p.rawSpec);
  return npLock.keyOf(p.name, version);
}

function relockSavedPackages(lockState, config, pkgs, saved) {
  if (!lockState) return;
  const { lockPackages } = config;
  const moved = new Map();
  for (const { item, saveName, saveSpec } of saved) {
    const key = saveName && npLock.keyOf(saveName, saveSpec);
    if (key && item.lockKey) moved.set(item.lockKey, key);
  }
  // 非浮动的旧键保留: 传递依赖可能也用到它, 删掉后下次 --frozen-lockfile 会报缺失; 下次完整安装自然清掉
  for (const [from, to] of moved) {
    if (from === to || !lockPackages[from]) continue;
    lockPackages[to] = lockPackages[from];
  }
  for (const item of pkgs) {
    if (!item.floating || !item.lockKey || moved.get(item.lockKey) === item.lockKey) continue;
    delete lockPackages[item.lockKey];
    delete lockState.previous[item.lockKey];
  }
}

// 未在命令行出现(`--x`, `--no-x`, `--x=`)时删掉 minimist 填的 false, 让它回落到环境变量与 ~/.nprc
function dropUnsetFlags(argv, args) {
  const end = args.indexOf('--');
  const cliArgs = end === -1 ? args : args.slice(0, end);
  for (const name of TRISTATE_FLAGS) {
    const given = cliArgs.some(arg => arg === `--${name}` || arg === `--no-${name}` || arg.startsWith(`--${name}=`));
    if (!given) delete argv[name];
  }
}

// 完整安装用本次实际用到的条目覆盖锁文件; 部分安装(指定包, --production 等)只追加, 保留其余条目
async function writeLockfile(root, lockState, config, { full }) {
  if (!lockState || config.frozenLockfile) return;
  const packages =
    full && !lockState.workspaces ? config.lockPackages : { ...lockState.previous, ...config.lockPackages };
  if (await npLock.write(root, packages)) {
    console.info(chalk.gray('npd %s updated'), npLock.LOCKFILE_NAME);
  }
}

const NPM_CONFIG_TIMEOUT = 30 * 1000;
function getVersionSavePrefix() {
  try {
    return execSync('npm config get save-prefix', { timeout: NPM_CONFIG_TIMEOUT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (err) {
    debug(`exec npm config get save-prefix ERROR: ${err.message}`);
    return '^';
  }
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

async function updateDependencies(root, pkgs, propName, saveExact, remoteNames) {
  const pkgFile = path.join(root, 'package.json');
  const pkg = await utils.readJSON(pkgFile);
  const deps = (pkg[propName] = pkg[propName] || {});
  const saved = [];
  for (const item of pkgs) {
    let saveName;
    let saveSpec;
    if (REMOTE_TYPES.includes(item.type)) {
      // if install from remote or git and don't specified name
      // get package's name from `remoteNames`
      saveName = item.name || remoteNames[item.version];
      saveSpec = item.version;
    } else if (item.type === ALIAS_TYPES) {
      saveName = item.alias;
      saveSpec = item.arg.rawSpec;
    } else {
      let version;
      if (LOCAL_TYPES.includes(item.type)) {
        const itemPkg = await utils.readJSON(path.join(item.version, 'package.json'));
        saveName = itemPkg.name;
        version = itemPkg.version;
      } else {
        // registry 包的名字与版本取自 registry 解析结果(store 目录名); tarball 里的 package.json 可以自称任意包
        saveName = item.name;
        const pkgDir = path.join(root, 'node_modules', item.name);
        const stored = utils.parsePackageStorePath(await fs.realpath(pkgDir).catch(() => pkgDir));
        version = stored ? stored.version : (await utils.readJSON(path.join(pkgDir, 'package.json'))).version;
      }

      // If install with `npd foo`, the type is tag but rawSpec is empty string
      if (item.arg.type === 'tag' && item.arg.rawSpec) {
        saveSpec = item.arg.rawSpec;
      } else {
        const savePrefix = saveExact ? '' : getVersionSavePrefix();
        saveSpec = `${savePrefix}${version}`;
      }
    }
    deps[saveName] = saveSpec;
    saved.push({ item, saveName, saveSpec });
  }
  // sort pkg[propName]
  const newDeps = {};
  for (const key of Object.keys(deps).sort()) {
    newDeps[key] = deps[key];
  }
  pkg[propName] = newDeps;
  await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  return saved;
}
