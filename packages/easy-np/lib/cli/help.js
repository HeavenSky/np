// np 与 np-x 全部命令的帮助文本; 子命令名与别名由 index.js 的命令表传入
const SUMMARIES = {
  install: 'install dependencies, same as np',
  uninstall: 'remove packages and their hoisted links',
  update: 'remove node_modules then reinstall',
  link: 'link local folders or global packages',
  fetch: 'only download and extract packages, no dependencies or scripts',
  rebuild: 'rerun lifecycle scripts of installed dependencies',
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
np is the same as np-x install.

Options:

  -v, --version: show version
  -h, --help: show help
`;
};

exports.install = () => `
Usage:

  np
  np <pkg>
  np <pkg> --workspace=<workspace>
  np <pkg> -w <workspace>
  np <pkg> --workspaces
  np <pkg>@<tag>
  np <pkg>@<version>
  np <pkg>@<version range>
  np <folder>
  np <tarball file>
  np <tarball url>
  np <git:// url>
  np <github username>/<github project>
  np --lockfile-path=</path/to/package-lock.json>

Can specify one or more: np ./foo.tgz bar@stable /some/folder
If no argument is supplied, installs dependencies from ./package.json.
np-x install, np-x i and np-x add are the same as np; run np-x -h for other commands.
With <pkg>, only the given packages are installed: other dependencies in package.json are not refreshed and root lifecycle scripts are not run.

Options:

  --production: won't install devDependencies
  --client: install clientDependencies and buildDependencies
  --save, --save-dev, --save-optional, --save-exact, --save-client, --save-build, --save-isomorphic: save installed dependencies into package.json
  --no-save: Prevents saving to dependencies
  -g, --global: install packages to the global directory specified by 'npm config get prefix'
  -r, --registry: specify custom registry
  --proxy, --https-proxy: proxy for http / https requests, also passed to install scripts, node-gyp and git; default from npm_config_proxy, ~/.nprc, HTTP_PROXY / HTTPS_PROXY
  --noproxy: comma separated hosts that bypass the proxy, default from NO_PROXY
  --cafile: CA certificate file for https requests
  --no-strict-ssl: skip https certificate verification
  --root: install root directory, default is current working directory
  --prefix: global install prefix used with -g, default is '$npm config get prefix'
  --no-cache: don't use the tarball disk cache, ignored when --cache-strict is set
  --tarball-url-mapping: JSON object to rewrite tarball urls before request, redirect targets are not rewritten, e.g.: --tarball-url-mapping='{"https://a.com":"https://b.com"}'
  --lockfile-path: install from package-lock.json (lockfileVersion >= 2), optionalDependencies in lockfile are ignored, not supported with workspaces, fail if the lockfile can't be loaded
  --save-dependencies-tree: save the resolved dependencies tree to node_modules/.dependencies_tree.json
  -v, --version: show version
  -h, --help: show help
  --refresh-cache: ignore cached manifests and tarballs, download again and overwrite the cache
  --no-lockfile: don't read or write np-lock.json, same as env np_lockfile=false, or set config.np.lockfile=false in package.json
  --frozen-lockfile: install exactly the versions in np-lock.json, fail if a dependency is not locked, never update it
  --probe-cache: minutes to reuse the last registry speed test result, 0 to test on every run, default 5, also read from env np_probe_cache
  -d, --detail: show detail log of installation
  -w, --workspace: install on one workspace only, e.g.: np koa -w a
  --workspaces: install on all workspaces, e.g.: np foo --workspaces; without <pkg> the workspace root's own dependencies are not installed
  --trace: show memory and CPU usage traces of the installation
  --ignore-scripts: ignore all preinstall / install and postinstall scripts during the installation
  --rebuild: same as np-x rebuild, rerun lifecycle scripts of installed dependencies, see np-x rebuild --help
  --foreground-scripts: scripts run in the background by default, to see the output, run with: --foreground-scripts
  --no-optional: ignore all optionalDependencies during the installation
  --forbidden-licenses: forbid installing packages that use these licenses
  --engine-strict: refuse to install (or even consider installing) any package that claims to not be compatible with the current Node.js version.
  --legacy-peer-deps: don't install missing peerDependencies automatically, only warn like npm 6
  --flatten: flatten dependencies by matching ancestors' dependencies
  --registry-only: make sure all packages are installed from the registry, installing any package from a remote source (e.g.: git, remote url) fails the install.
  --cache-strict: use disk cache even on production env.
  --fix-bug-versions: automatically fix bug version of packages.
  --dependencies-tree: install with dependencies tree to restore the last install.
  --fetch-only: same as np-x fetch, only download and extract the listed packages without their dependencies and scripts
  --public-hoist-pattern: regexp of package names to link into <root>/node_modules with their latest version, falls back to config.np.publicHoistPattern in package.json, default is none.
  --dedup: link every package's latest version into <root>/node_modules like npminstall@6, overrides --public-hoist-pattern.
  --offline: only use the disk cache and never request the network, fail when a manifest or tarball is not cached. git and remote url packages are not supported.
`;

exports.uninstall = () => `
Usage:

  np-x uninstall <pkg>
  np-x uninstall <pkg>@<version>
  np-x uninstall <pkg>@<version> [<pkg>@<version>]

Options:

  --root: project root directory, default is current working directory
  -g, --global: uninstall from the global directory
  --prefix: global install prefix used with -g, default is '$npm config get prefix'
  -w, --workspace: uninstall on one workspace only, e.g.: np-x uninstall koa -w a
  --workspaces: uninstall on all workspaces
  -v, --version: show version
  -h, --help: show help
`;

exports.update = root => `
Usage:

  np-x update [--root=${root}]

Remove node_modules of root and workspaces, then reinstall.

Options:

  --root: project root directory, default is current working directory
  -w, --workspace: only clean the given workspace's node_modules then reinstall it, root node_modules and the shared store are kept
  --clean-only: only remove node_modules, don't reinstall
  -h, --help: show help
`;

exports.link = () => `
Usage:

  np-x link <folder>

Can specify one or more: np-x link /some/folder1 /some/folder2
Without <folder>, install current package and link it to the global directory.

Options:

  --root: project root directory, default is current working directory
  --prefix: global install prefix, default is '$npm config get prefix'
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

  -r, --registry: specify custom registry
  --proxy, --https-proxy: proxy for http / https requests, also passed to install scripts, node-gyp and git; default from npm_config_proxy, ~/.nprc, HTTP_PROXY / HTTPS_PROXY
  --noproxy: comma separated hosts that bypass the proxy, default from NO_PROXY
  --cafile: CA certificate file for https requests
  --no-strict-ssl: skip https certificate verification
  --root: install root directory, default is current working directory
  --no-cache: don't use the tarball disk cache
  --refresh-cache: ignore cached manifests and tarballs, download again and overwrite the cache
  --offline: only use the disk cache and never request the network
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

Options:

  --root: install root directory, default is current working directory
  -v, --version: show version
  -h, --help: show help
`;
