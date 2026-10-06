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
const help = require('./help');

module.exports = async function install(args, { ignorePkgNames = false, ignoreLockfile = false } = {}) {
  try {
    await main(args, { ignorePkgNames, ignoreLockfile });
  } catch (err) {
    // 失败汇总已列出每个包的错误, 不再打印调用栈
    console.error(chalk.red(err.code === utils.INSTALL_FAILURES_CODE ? err.message : err.stack));
    console.error(chalk.yellow('npd version: %s'), require('../../package.json').version);
    console.error(chalk.yellow('npd args: %s'), process.argv.join(' '));
    process.exit(1);
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
        // --proxy 已移除: urllib 3 不支持 proxy / enableProxy 参数, 传入后请求仍直连
        // --high-speed-store=filepath
        'high-speed-store',
        'dependencies-tree',
        /**
         * set package-lock.json path
         *
         * 1. only support package lock v2 and v3.
         * 2. npd doesn't inspect <cwd>/package-lock.json by default.
         * 3. because arborist doesn't support client/build/isomorphic dependencies,
         *    these kinds of dependencies will all be ignored.
         * 4. this option doesn't do extra check for the equivalence of package-lock.json and package.json
         *    simply behaves like `npm ci` but doesn't remove the node_modules in advance.
         * 5. you're not supposed to install extra dependencies along with a lockfile.
         */
        'lockfile-path',
        'probe-cache',
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
        'refresh-cache',
        'frozen-lockfile',
        'rebuild',
        'offline',
        // --force-link-latest 已移除: 提升到根目录时始终链接最高版本
      ],
      default: {
        optional: true,
      },
      alias: {
        // npm install [-S|--save|-D|--save-dev|-O|--save-optional] [-E|--save-exact] [-d|--detail]
        S: 'save',
        D: 'save-dev',
        O: 'save-optional',
        E: 'save-exact',
        v: 'version',
        h: 'help',
        g: 'global',
        r: 'registry',
        d: 'detail',
      },
    })
  );

  if (argv.version) {
    console.log(`npd v${require('../../package.json').version}`);
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
      // `npd foo` 未写版本时 npa 补成 latest tag, 改传 `*` 以便选版时与显式的 `foo@latest` 区分并检查 engines
      version: p.type === 'tag' && !p.rawSpec ? '*' : p.fetchSpec || p.rawSpec,
      type: p.type,
      alias: aliasPackageName,
      arg: p,
    });
  }

  let root = argv.root || process.cwd();
  if (Array.isArray(root)) {
    // use last one, e.g.: $ npd --root=abc --root=def
    root = root[root.length - 1];
  }
  const production = argv.production || process.env.NODE_ENV === 'production';
  let cacheDir = argv.cache === false ? '' : null;
  if (production) {
    cacheDir = '';
  }
  // support npm_config_cache to change default cache dir
  if (cacheDir === null && process.env.npm_config_cache) {
    cacheDir = process.env.npm_config_cache;
  }
  if (process.env.np_cache) {
    cacheDir = process.env.np_cache;
  }
  // 测速缓存不受 --production 关闭磁盘缓存影响, 只在 --no-cache 时停用
  const probeCacheDir =
    argv.cache === false
      ? ''
      : process.env.np_cache || process.env.npm_config_cache || path.join(os.homedir(), '.np_tarball');
  const offline = !!argv.offline;
  // rebuild 优先用磁盘缓存中的 manifest 与 tgz, 缓存缺失时才联网
  const preferOffline = !!argv.rebuild && !offline;
  if (offline && cacheDir === '' && !argv['cache-strict']) {
    console.error(
      chalk.red(
        'npd ERROR --offline needs the disk cache, it can not be used with --no-cache, or --production without --cache-strict'
      )
    );
    process.exit(1);
  }

  let forbiddenLicenses = argv['forbidden-licenses'];
  forbiddenLicenses = forbiddenLicenses ? forbiddenLicenses.split(',') : null;

  const flatten = argv.flatten;

  // example: npd --registry xx --registry xxxx
  let registry = (Array.isArray(argv.registry) ? argv.registry[0] : argv.registry) || process.env.npm_registry;
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

  debug('argv: %j, env: %j', argv, env);

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
    cacheStrict: argv['cache-strict'],
    cacheDir,
    refreshCache: argv['refresh-cache'],
    offline,
    preferOffline,
    mirror: mirrorState,
    env,
    binaryMirrors,
    forbiddenLicenses,
    flatten,
  };
  // 不再读取 npm 的 strict-ssl: urllib 3 不支持 rejectUnauthorized, HTTPS 证书始终校验
  config.ignoreScripts = argv['ignore-scripts'] || getIgnoreScripts();
  config.rebuild = argv.rebuild;
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
    config.formatNpmTarbalUrl = function formatNpmTarbalUrl(url) {
      for (const fromUrl in tarballUrlMapping) {
        const toUrl = tarballUrlMapping[fromUrl];
        url = url.replace(fromUrl, toUrl);
      }
      return url;
    };
  }

  if (argv['fix-bug-versions']) {
    const packageVersionMapping = await utils.getBugVersions(registry, { offline, preferOffline });
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
      console.warn(chalk.yellow('npd WARN load dependencies tree %s error: %s'), dependenciesTree, err.message);
    }
  }
  if (argv['save-dependencies-tree']) {
    config.saveDependenciesTree = true;
  }

  // 默认读写 <root>/np-lock.json; --lockfile-path, --dependencies-tree 与 -g 有各自的版本来源, 不使用它
  let lockState = null;
  // 与 easy-np 共用同一份锁文件, 开关也读同一个 config.np.lockfile
  const rootConfig = (await utils.readJSON(path.join(root, 'package.json'))).config?.np || {};
  const lockfileDisabled = argv.lockfile === false || ['0', 'false'].includes(process.env.np_lockfile);
  if (!argv.global && !lockfilePath && !dependenciesTree && !lockfileDisabled && rootConfig.lockfile !== false) {
    const lockExists = await npLock.exists(root);
    if (argv['frozen-lockfile'] && !lockExists) {
      throw new Error(`--frozen-lockfile requires ${npLock.LOCKFILE_NAME} in ${root}`);
    }
    if (lockExists || !(await npLock.hasForeignLockfile(root))) {
      const previous = lockExists ? await npLock.read(root) : {};
      // npd-x update 要升级到范围内的最新版本, 不复用已锁定的版本
      config.dependenciesTree = ignoreLockfile ? {} : previous;
      config.lockPackages = {};
      config.frozenLockfile = !!argv['frozen-lockfile'];
      lockState = { previous };
    }
  }

  if (argv['high-speed-store']) {
    config.highSpeedStore = require(argv['high-speed-store']);
  }

  if (argv['fetch-only']) {
    if (argv.global || pkgs.length === 0) {
      throw new Error('npd-x fetch needs at least one package and does not support -g');
    }
    await fetchOnly(config, context);
    return;
  }

  if (argv.rebuild && pkgs.length > 0) {
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
    await installLocal(config, context);
    await writeLockfile(root, lockState, config, {
      full: pkgs.length === 0 && !config.production && argv.optional !== false && !argv.client,
    });
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

      //    install saves any specified packages into dependencies by default.
      if (Object.keys(map).every(key => !argv[key]) && !argv['no-save']) {
        await updateDependencies(root, pkgs, map.save, argv['save-exact'], config.remoteNames);
      } else {
        for (const key in map) {
          if (argv[key]) await updateDependencies(root, pkgs, map[key], argv['save-exact'], config.remoteNames);
        }
      }
    }
  }

  process.on('exit', code => {
    if (code !== 0) {
      writeFileSync(path.join(root, 'npd-debug.log'), util.inspect(config, { depth: 2 }));
    }
  });
}

// 完整安装用本次实际用到的条目覆盖锁文件; 部分安装(指定包, --production 等)只追加, 保留其余条目
async function writeLockfile(root, lockState, config, { full }) {
  if (!lockState || config.frozenLockfile) return;
  const packages = full ? config.lockPackages : { ...lockState.previous, ...config.lockPackages };
  if (await npLock.write(root, packages)) {
    console.info(chalk.gray('npd %s updated'), npLock.LOCKFILE_NAME);
  }
}

function getVersionSavePrefix() {
  try {
    return execSync('npm config get save-prefix').toString().trim();
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
  for (const item of pkgs) {
    if (REMOTE_TYPES.includes(item.type)) {
      // if install from remote or git and don't specified name
      // get package's name from `remoteNames`
      deps[item.name || remoteNames[item.version]] = item.version;
    } else if (item.type === ALIAS_TYPES) {
      deps[item.name] = item.version;
    } else {
      const pkgDir = LOCAL_TYPES.includes(item.type) ? item.version : path.join(root, 'node_modules', item.name);
      const itemPkg = await utils.readJSON(path.join(pkgDir, 'package.json'));

      let saveSpec;
      // If install with `npd foo`, the type is tag but rawSpec is empty string
      if (item.arg.type === 'tag' && item.arg.rawSpec) {
        saveSpec = item.arg.rawSpec;
      } else {
        const savePrefix = saveExact ? '' : getVersionSavePrefix();
        saveSpec = `${savePrefix}${itemPkg.version}`;
      }
      deps[itemPkg.name] = saveSpec;
    }
  }
  // sort pkg[propName]
  const newDeps = {};
  for (const key of Object.keys(deps).sort()) {
    newDeps[key] = deps[key];
  }
  pkg[propName] = newDeps;
  await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}
