// np 与 np-x 全部命令的帮助文本; 子命令名与别名由 index.js 的命令表传入
const SUMMARIES = {
  install: 'install dependencies with npm / pnpm style defaults',
  uninstall: 'remove packages, their hoisted links and package versions nothing uses',
  update: 'remove node_modules then reinstall',
  link: 'link local folders or global packages',
  fetch: 'only download and extract packages, no dependencies or scripts',
  rebuild: 'rerun lifecycle scripts of installed dependencies',
  'approve-scripts': 'allow install scripts of dependencies in package.json allowScripts',
  'deny-scripts': 'deny install scripts of dependencies in package.json allowScripts',
  prune: 'remove package versions in node_modules/.store that nothing links to',
};

// commands: [{ name, aliases }], 顺序即展示顺序
exports.commands = commands => {
  const rows = commands.map(cmd => [[cmd.name, ...cmd.aliases].join(', '), SUMMARIES[cmd.name]]);
  rows.push(['help <command>', 'show help of a command']);
  const width = Math.max(...rows.map(row => row[0].length)) + 2;
  return `
Usage:

  np-x <command> [options]

Commands:

${rows.map(([names, summary]) => `  ${names.padEnd(width)}${summary}`).join('\n')}

Run "np-x <command> -h" for the options of a command.
np is np-x install with --no-lockfile --dangerously-allow-all-scripts added.

Options:

  -v, --version: show version
  -h, --help: show help
`;
};

exports.install = () => `
Usage:

  np [<pkg> ...] [options]

  <pkg>: <name>[@<tag|version|range>], <alias>@npm:<name>, <folder>, <tarball file>, <tarball url>, <git url>, <user>/<repo>
  Without <pkg>, installs dependencies from ./package.json; with <pkg>, only the given packages are installed and saved,
  other dependencies are not refreshed and root lifecycle scripts are not run.
  Inside a workspace folder, only that workspace is installed.
  np-x install, np-x i and np-x add are np without the two options below; run np-x -h for other commands.

  np adds --no-lockfile and --dangerously-allow-all-scripts as if given on the command line: env and config files can't change them,
  only --lockfile, --frozen-lockfile or --no-dangerously-allow-all-scripts on the command line can.
  Both read settings from ~/.nprc, .npmrc, pnpm-workspace.yaml and the pnpm field of package.json.

Dependency types:

  <type> is a dependency field of package.json: prod is dependencies, dev is devDependencies, optional is optionalDependencies,
  peer is peerDependencies, any other <type> is <type>Dependencies, e.g. client, build. Every option below takes any <type>.

  --only=<type>[,...]: install only these fields of package.json, e.g. --only=prod, --only=client,build
  --include=<type>[,...]: also install these fields, e.g. --include=client
  --omit=<type>[,...], --exclude=<type>[,...]: skip these fields, e.g. --omit=dev
  --write=<type>: save the given packages to this field instead of dependencies, e.g. --write=dev, --write=peer;
    only the --write=<type> form is accepted
  --write-exact: save the exact version instead of a ^ range
  --no-save, --no-write: don't change package.json
  --prod: same as --only=prod
  --production: same as NODE_ENV=production

  Without --only, prod, dev and optional are installed; --production or NODE_ENV=production adds --omit=dev;
  --omit=optional also skips optional dependencies of every package, --omit=peer stops installing missing peerDependencies.
  A type in both --include and --omit is installed.

  --engine-strict: refuse packages whose engines.node does not match the current Node.js

Lockfile:

  --lockfile, --no-lockfile: read and write np-lock.json or not, default on (np adds --no-lockfile);
    also set by env np_lockfile=true|false, config.np.lockfile in package.json, lockfile in pnpm settings, lockfile / package-lock in .npmrc
  --frozen-lockfile: install exactly the versions in np-lock.json, fail if a dependency is not locked, never update it;
    can't be used with package names
  --from-package-lock=<file>: install the versions in a package-lock.json (lockfileVersion >= 2), optionalDependencies in it are ignored

Install scripts:

  --ignore-scripts: run no install scripts at all
  --allow-scripts=<pkg>[,<pkg>]: allow install scripts of these dependencies, overrides allowScripts in package.json,
    pnpm build settings (onlyBuiltDependencies, ...) and ~/.nprc; mainly for -g
  --strict-allow-scripts: fail when a dependency has install scripts not reviewed in allowScripts;
    also npm_config_*, ~/.nprc, .npmrc, pnpm strictDepBuilds
  --dangerously-allow-all-scripts: run install scripts of every dependency, ignoring allowScripts;
    default off (np adds it, turn it off with --no-dangerously-allow-all-scripts); also npm_config_*, ~/.nprc, .npmrc, pnpm dangerouslyAllowAllBuilds
  --foreground-scripts: show the output of dependency install scripts, they run in the background by default;
    scripts of the root project and local folder dependencies always show their output

Registry and network:

  -r, --registry=<url>: registry to install from, default from npm_registry, ~/.nprc, .npmrc / npm_config_registry;
    npmmirror and npmjs switch automatically by speed, other registries turn the switch off
  --probe-cache=<minutes>: reuse the last registry speed test for this long, 0 to test on every run, default 5; also env np_probe_cache
  --proxy=<url>, --https-proxy=<url>: proxy for http / https requests, also passed to install scripts, node-gyp and git;
    default from npm_config_proxy, ~/.nprc, HTTP_PROXY / HTTPS_PROXY
  --noproxy=<host>[,<host>]: hosts that bypass the proxy; default from npm_config_noproxy, ~/.nprc, NO_PROXY
  --cafile=<file>: CA certificate file for https requests
  --strict-ssl, --no-strict-ssl: verify https certificates or not, default on; also npm_config_strict_ssl and ~/.nprc,
    --strict-ssl overrides npm_config_strict_ssl=false inherited from the environment
  --registry-only: fail when any package comes from git or a remote url
  --forbidden-licenses=<license>[,<license>]: fail when a package uses one of these licenses

Cache:

  --offline: only use the disk cache and never request the network; git and remote url packages are not supported
  --prefer-offline: use cached manifests without revalidating them, only request the network for packages not in the cache
  --refresh-cache: ignore cached manifests and tarballs, download again and overwrite the cache
  --no-cache: don't use the disk cache
  The disk cache is ~/.np_tarball, shared with easy-npd; env np_cache or npm_config_cache changes it

Workspaces and hoisting:

  --ws, --workspaces: install on all workspaces; with <pkg>, the packages are added to every workspace;
    workspaces come from package.json workspaces, or packages in pnpm-workspace.yaml
  --shamefully-hoist: link every package's latest version into <root>/node_modules, overrides --public-hoist-pattern;
    also pnpm shamefullyHoist / nodeLinker: hoisted, .npmrc shamefully-hoist / node-linker=hoisted / install-strategy=hoisted
  --public-hoist-pattern=<regexp>: link matching packages into <root>/node_modules with their latest version;
    falls back to config.np.publicHoistPattern in package.json, then to pnpm / .npmrc settings

Global install:

  -g, --global: install packages to the global directory
  --prefix=<dir>: global install prefix, default is 'npm config get prefix'

Output:

  --detail: show detail log of installation
  --trace: show memory and CPU usage of the installation
  -v, --version: show version
  -h, --help: show help
`;

exports.uninstall = () => `
Usage:

  np-x uninstall <pkg>
  np-x uninstall <pkg>@<version>
  np-x uninstall <pkg>@<version> [<pkg>@<version>]

Inside a workspace folder, only that workspace is changed.

Options:

  -g, --global: uninstall from the global directory
  --prefix=<dir>: global install prefix used with -g, default is 'npm config get prefix'
  --ws, --workspaces: uninstall on all workspaces
  --write=<type>: also remove the packages from <type>Dependencies, e.g. --write=client;
    dependencies, devDependencies, optionalDependencies and peerDependencies are always cleaned
  -v, --version: show version
  -h, --help: show help
`;

exports.update = () => `
Usage:

  np-x update

Remove node_modules of root and workspaces, then reinstall, ignoring the versions locked in np-lock.json.
Options of np-x install, e.g. --registry, are passed to the reinstall.
Inside a workspace folder, only that workspace's node_modules is removed and reinstalled, root node_modules and the shared store are kept.

Options:

  --clean-only: only remove node_modules, don't reinstall
  -v, --version: show version
  -h, --help: show help
`;

exports.link = () => `
Usage:

  np-x link <folder>

Can specify one or more: np-x link /some/folder1 /some/folder2
Without <folder>, install current package and link it to the global directory.
Options of np-x install written as --name or --name=value, e.g. --registry=<url>, are passed to the installs it runs.

Options:

  --prefix=<dir>: global install prefix, default is 'npm config get prefix'
  -v, --version: show version
  -h, --help: show help
`;

exports.fetch = () => `
Usage:

  np-x fetch <pkg> [<pkg> ...]

Only download, verify and extract the listed packages, then link them to node_modules/<name>.
Dependencies are not installed, no lifecycle scripts run, no bin links are created and package.json is not changed.
A later full np install processes these packages again and installs their dependencies.
git packages are not supported, fetching them runs their prepare script.

Options:

  -r, --registry, --proxy, --https-proxy, --noproxy, --cafile, --no-strict-ssl: same as np-x install
  --offline, --prefer-offline, --refresh-cache, --no-cache: same as np-x install
  -v, --version: show version
  -h, --help: show help
`;

exports.rebuild = () => `
Usage:

  np-x rebuild
  np-x rebuild <pkg>[@<version range>] [<pkg>[@<version range>] ...]

A plain np already continues packages left unfinished by a failed or interrupted run, from the stage where they stopped.
Use np-x rebuild for node_modules installed by np 0.0.1 or earlier, or after switching Node.js.

Without <pkg>, install every dependency in package.json again without downloading it,
and rerun the preinstall / install / postinstall scripts of every dependency in dependency order.
With <pkg>, only rerun the preinstall / install / postinstall scripts of every installed version of the listed packages,
<version range> limits the versions. Packages are not downloaded again, dependencies and package.json are not changed.
Options of np-x install, e.g. --registry, --offline, --ignore-scripts, also apply.

Options:

  -v, --version: show version
  -h, --help: show help
`;

exports.approveScripts = () => `
Usage:

  np-x approve-scripts <pkg> [<pkg> ...]
  np-x approve <pkg> [<pkg> ...]
  np-x approve-scripts --all
  np-x approve-scripts --pending

Install scripts (preinstall / install / postinstall, binding.gyp builds and prepare of git dependencies) of dependencies
only run when the dependency is allowed in the allowScripts field of the root package.json, same as npm 12.
Scripts of the root project, workspaces and local folder dependencies always run.
This command writes allowScripts entries for installed packages; run np-x rebuild <pkg> afterwards to run their scripts,
reinstall git dependencies to run their prepare script.

Options:

  --all: approve every installed package whose install scripts are not reviewed yet
  --pending: only list installed packages whose install scripts are not reviewed yet
  --no-pin: write name-only entries that allow any version, default writes <pkg>@<installed version>
  -v, --version: show version
  -h, --help: show help
`;

exports.prune = () => `
Usage:

  np-x prune
  np-x prune --dry-run

Upgrading packages leaves their old versions in node_modules/.store; np-x uninstall removes unreferenced versions by itself.
This command walks the links from node_modules of the project and every workspace,
removes the <name>@<version> folders in node_modules/.store that are not reachable,
and the fallback links in node_modules/.store/node_modules that point to them.
Installs never remove these folders by themselves.

Options:

  --dry-run: only list what would be removed
  -v, --version: show version
  -h, --help: show help
`;

exports.denyScripts = () => `
Usage:

  np-x deny-scripts <pkg> [<pkg> ...]
  np-x deny <pkg> [<pkg> ...]
  np-x deny-scripts --all

Writes name-only false entries into the allowScripts field of the root package.json, same as npm 12:
the install scripts of these dependencies never run and they are no longer listed as unreviewed.
Existing true entries of the same packages are removed. Packages that are not installed can be denied by name.
Git and tarball url dependencies are denied by their repository or url.

Options:

  --all: deny every installed package whose install scripts are not reviewed yet
  -v, --version: show version
  -h, --help: show help
`;
