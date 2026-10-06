const debug = require('node:util').debuglog('np:download:local');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const chalk = require('chalk');
const semver = require('semver');
const utils = require('../utils');

const NPM_VERSION_TIMEOUT = 30 * 1000;
const NPM_PACK_TIMEOUT = 30 * 60 * 1000;

module.exports = async (pkg, options) => {
  const { fetchSpec, displayName } = pkg;
  options.localPackages++;
  let filepath = fetchSpec;

  try {
    filepath = await fs.realpath(filepath);
    const stat = await fs.stat(filepath);
    // _scriptsOwner 为 undefined 时删掉包内自带的同名字段, 否则受信本地包可冒充其他包的放行身份
    const meta = { _from: pkg.raw, _resolved: `file:${filepath}`, _scriptsOwner: pkg.scriptsOwner };
    const suffix = utils.sourceSuffix('file', filepath);
    return stat.isDirectory()
      ? await localFolder(filepath, pkg, options, meta, suffix)
      : await localTarball(filepath, pkg, options, meta, suffix);
  } catch (err) {
    throw new Error(`[${displayName}] resolved target ${filepath} error: ${err.message}`);
  }
};

async function localFolder(filepath, pkg, options, meta, suffix) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local folder ${filepath}`);
  // npm 8 的 npm pack --ignore-scripts 仍会执行 prepack, 不能执行脚本时不能交给 npm pack
  if (pkg.untrustedLocal || options.ignoreScripts || !(await supportsPackDestination())) {
    return await copyFolder(filepath, options, meta, suffix);
  }
  // everytime pack to a different directory to avoid parallel install
  const tmpDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(tmpDir);
  try {
    let tarball;
    try {
      await utils.spawnWithTimeout(`npm pack --pack-destination "${tmpDir}"`, [], {
        cwd: filepath,
        timeout: NPM_PACK_TIMEOUT,
        name: 'npm pack',
        shell: true,
      });
      tarball = await packedTarball(tmpDir);
    } catch (err) {
      options.console.warn(
        `[np:download:local] install ${pkg.displayName} from local folder ${filepath} with npm pack failed(${err.message}), use copy${stderrTail(err)}`
      );
      return await copyFolder(filepath, options, meta, suffix);
    }
    return await localTarball(tarball, pkg, options, meta, suffix);
  } finally {
    await utils.rimraf(tmpDir);
  }
}

function stderrTail(err) {
  return err.stderr ? `\n${String(err.stderr).trim().split('\n').slice(-5).join('\n')}` : '';
}

// 从专用的输出目录取 tarball, 不解析 stdout: prepack 等脚本的输出也在 stdout 里, --json 的结构随 npm 版本变化
async function packedTarball(dir) {
  const tarballs = (await fs.readdir(dir)).filter(file => file.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`expected one tarball in npm pack output, found ${tarballs.length}`);
  return path.join(dir, tarballs[0]);
}

// --pack-destination 自 npm 7.18 起支持, 更早的 npm 会把 tarball 写进本地目录; 失败的探测不缓存
let npmVersionPending = null;
async function supportsPackDestination() {
  if (!npmVersionPending) {
    npmVersionPending = utils
      .exec('npm --version', { timeout: NPM_VERSION_TIMEOUT })
      .then(res => semver.valid(res.stdout.trim()));
    npmVersionPending.catch(() => (npmVersionPending = null));
  }
  const version = await npmVersionPending.catch(() => null);
  return !!version && semver.gte(version, '7.18.0');
}

// 按 npm pack 的文件规则复制, 不执行本地目录的任何脚本
async function copyFolder(filepath, options, meta, suffix) {
  const tmpDir = path.join(options.storeDir, '.tmp', randomUUID());
  try {
    await utils.copyPackFiles(filepath, tmpDir);
    const pkgFile = path.join(tmpDir, 'package.json');
    if (await utils.exists(pkgFile)) {
      await utils.addMetaToJSONFile(pkgFile, { ...meta, _contentHash: await utils.hashDir(tmpDir) });
    }
    return await utils.copyInstall(tmpDir, options, suffix);
  } finally {
    await utils.rimraf(tmpDir);
  }
}

async function localTarball(filepath, pkg, options, meta, suffix) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local tarball ${filepath}`);
  const readstream = createReadStream(filepath);
  // everytime unpack to a different directory
  const ungzipDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(ungzipDir);
  try {
    await utils.unpack(readstream, ungzipDir, pkg);
    const pkgFile = path.join(ungzipDir, 'package.json');
    if (await utils.exists(pkgFile)) {
      await utils.addMetaToJSONFile(pkgFile, { ...meta, _contentHash: await utils.hashDir(ungzipDir) });
    }
    return await utils.copyInstall(ungzipDir, options, suffix);
  } finally {
    // clean up
    try {
      await utils.rimraf(ungzipDir);
    } catch (err) {
      options.console.warn(
        chalk.yellow(
          `[np:download:local] ${pkg.displayName} rmdir local ungzip dir: ${ungzipDir} error: ${err}, ignore it`
        )
      );
    }
  }
}
