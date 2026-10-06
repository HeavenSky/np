// npd 与 npd-x 全部命令的帮助文本; 子命令名与别名由 index.js 的命令表传入
'use strict';

const SUMMARIES = {
  install: 'install dependencies, same as npd',
  uninstall: 'remove packages',
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

  npd-x <command> [options]

Commands:

${rows.map(([names, summary]) => `  ${names.padEnd(width)}${summary}`).join('\n')}

Run "npd-x <command> -h" for the options of a command.
npd is the same as npd-x install.

Options:

  -v, --version: show version
  -h, --help: show help
`;
};

exports.install = () => `
Usage:

  npd
  npd <pkg>
  npd <pkg>@<tag>
  npd <pkg>@<version>
  npd <pkg>@<version range>
  npd <folder>
  npd <tarball file>
  npd <tarball url>
  npd <git:// url>
  npd <github username>/<github project>
  npd --lockfile-path=</path/to/package-lock.json>

Can specify one or more: npd ./foo.tgz bar@stable /some/folder
If no argument is supplied, installs dependencies from ./package.json.
npd-x install, npd-x i and npd-x add are the same as npd; run npd-x -h for other commands.

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
  --lockfile-path: install from package-lock.json (lockfileVersion >= 2), optionalDependencies in lockfile are ignored, fail if the lockfile can't be loaded
  --save-dependencies-tree: save the resolved dependencies tree to node_modules/.dependencies_tree.json
  -v, --version: show version
  -h, --help: show help
  --refresh-cache: ignore cached manifests and tarballs, download again and overwrite the cache
  --no-lockfile: don't read or write np-lock.json, same as env np_lockfile=false, or set config.np.lockfile=false in package.json
  --frozen-lockfile: install exactly the versions in np-lock.json, fail if a dependency is not locked, never update it
  --probe-cache: minutes to reuse the last registry speed test result, 0 to test on every run, default 5, also read from env np_probe_cache
  --offline: only use the disk cache and never request the network, fail when a manifest or tarball is not cached. git and remote url packages are not supported.
  -d, --detail: show detail log of installation
  --trace: show memory and CPU usage traces of the installation
  --ignore-scripts: ignore all preinstall / install and postinstall scripts during the installation
  --rebuild: same as npd-x rebuild, rerun lifecycle scripts of installed dependencies, see npd-x rebuild --help
  --no-optional: ignore all optionalDependencies during the installation
  --forbidden-licenses: forbid installing packages that use these licenses
  --engine-strict: refuse to install (or even consider installing) any package that claims to not be compatible with the current Node.js version.
  --legacy-peer-deps: don't install missing peerDependencies automatically, only warn like npm 6
  --flatten: flatten dependencies by matching ancestors' dependencies
  --registry-only: make sure all packages are installed from the registry, installing any package from a remote source (e.g.: git, remote url) fails the install.
  --cache-strict: use disk cache even on production env.
  --fix-bug-versions: automatically fix bug version of packages.
  --high-speed-store: specify high speed store script to cache tgz files, and so on. Should export '* getStream(url)' function.
  --dependencies-tree: install with dependencies tree to restore the last install.
  --fetch-only: same as npd-x fetch, only download and extract the listed packages without their dependencies and scripts
`;

exports.uninstall = () => `
Usage:

  npd-x uninstall <pkg>
  npd-x uninstall <pkg>@<version>
  npd-x uninstall <pkg>@<version> [<pkg>@<version>]

Options:

  --root: project root directory, default is current working directory
  -g, --global: uninstall from the global directory
  --prefix: global install prefix used with -g, default is '$npm config get prefix'
  -S, --save, -D, --save-dev, -O, --save-optional: also remove the packages from dependencies, devDependencies or optionalDependencies in package.json
  -v, --version: show version
  -h, --help: show help
`;

exports.update = root => `
Usage:

  npd-x update [--root=${root}]

Remove node_modules, then reinstall.

Options:

  --root: project root directory, default is current working directory
  -h, --help: show help
`;

exports.link = () => `
Usage:

  npd-x link <folder>

Can specify one or more: npd-x link /some/folder1 /some/folder2
Without <folder>, install current package and link it to the global directory.

Options:

  --root: project root directory, default is current working directory
  --prefix: global install prefix, default is '$npm config get prefix'
  -v, --version: show version
  -h, --help: show help
`;

exports.fetch = () => `
Usage:

  npd-x fetch <pkg> [<pkg> ...]

Only download, verify and extract the listed packages, then link them to node_modules/<name>.
Dependencies are not installed, no lifecycle scripts run, no bin links are created and package.json is not changed.
A later full npd install processes these packages again and installs their dependencies.
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

  npd-x rebuild
  npd-x rebuild <pkg>[@<version range>] [<pkg>[@<version range>] ...]

A plain npd already continues packages left unfinished by a failed or interrupted run, from the stage where they stopped.
Use npd-x rebuild for node_modules installed by npd 0.0.1 or earlier, or after switching Node.js.

Without <pkg>, install every dependency in package.json again without downloading it,
and rerun the preinstall / install / postinstall scripts of every dependency in dependency order.
With <pkg>, only rerun the preinstall / install / postinstall scripts of every installed version of the listed packages,
<version range> limits the versions. Packages are not downloaded again, dependencies and package.json are not changed.

Options:

  --root: install root directory, default is current working directory
  -v, --version: show version
  -h, --help: show help
`;
