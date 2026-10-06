'use strict';

const debug = require('debug')('npd:download:local');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const { createReadStream } = require('fs');
const path = require('path');
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
    const meta = {
      _from: pkg.name ? `${pkg.name}@${pkg.rawSpec}` : pkg.rawSpec,
      _resolved: `file:${filepath}`,
    };
    // 不受信的本地包按声明者审核脚本, 之后 approve-scripts 与 rebuild 据此还原身份
    if (pkg.untrustedLocal) meta._scriptsOwner = pkg.scriptsOwner;
    const source = utils.fileSource(filepath);
    return stat.isDirectory()
      ? await localFolder(filepath, pkg, meta, source, options)
      : await localTarball(filepath, pkg, meta, source, options);
  } catch (err) {
    throw new Error(`[${displayName}] resolved target ${filepath} error: ${err.message}`);
  }
};

async function localFolder(filepath, pkg, meta, source, options) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local folder ${filepath}`);
  // everytime copy to a different directory to avoid parallel install
  const tmpDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(tmpDir);
  try {
    // 不受信的本地包只在放行后执行 preinstall / install / postinstall; npm 8 的 npm pack --ignore-scripts 仍会执行 prepack, 不能交给 npm pack
    if (!pkg.untrustedLocal && !options.ignoreScripts && (await npmMajor()) >= 7) {
      let tarball;
      try {
        tarball = await npmPack(filepath, tmpDir);
      } catch (err) {
        options.console.warn(
          `[npd:download:local] install ${pkg.displayName} from local folder ${filepath} with npm pack failed(${err.message}), use copy`
        );
      }
      if (tarball) return await localTarball(tarball, pkg, meta, source, options);
    }
    const packageDir = path.join(tmpDir, 'package');
    await utils.copyPackFiles(filepath, packageDir);
    const pkgFile = path.join(packageDir, 'package.json');
    if (await utils.exists(pkgFile)) await utils.addMetaToJSONFile(pkgFile, meta);
    return await utils.copyInstall(packageDir, options, source);
  } finally {
    await removeTmpDir(tmpDir, pkg, options);
  }
}

// npm 6 不支持 --pack-destination; 取不到版本时同样不用 npm pack
let npmMajorVersion;
function npmMajor() {
  if (!npmMajorVersion) {
    npmMajorVersion = utils.exec('npm --version', { timeout: NPM_VERSION_TIMEOUT }).then(
      ({ stdout }) => semver.major(semver.coerce(stdout) || '0.0.0'),
      () => 0
    );
  }
  return npmMajorVersion;
}

async function npmPack(filepath, dest) {
  await utils.exec(`npm pack --pack-destination "${dest}"`, { cwd: filepath, timeout: NPM_PACK_TIMEOUT });
  // prepack / prepare 的输出也写在 stdout 里, 文件名只能从空的输出目录取
  const tarballs = (await fs.readdir(dest)).filter(file => file.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`npm pack created ${tarballs.length} tarballs in ${dest}`);
  return path.join(dest, tarballs[0]);
}

async function localTarball(filepath, pkg, meta, source, options) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local tarball ${filepath}`);
  const readstream = createReadStream(filepath);
  // everytime unpack to a different directory
  const ungzipDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(ungzipDir);
  try {
    await utils.unpack(readstream, ungzipDir, pkg);
    const pkgFile = path.join(ungzipDir, 'package.json');
    if (await utils.exists(pkgFile)) await utils.addMetaToJSONFile(pkgFile, meta);
    return await utils.copyInstall(ungzipDir, options, source);
  } finally {
    await removeTmpDir(ungzipDir, pkg, options);
  }
}

async function removeTmpDir(dir, pkg, options) {
  try {
    await utils.rimraf(dir);
  } catch (err) {
    options.console.warn(
      chalk.yellow(`[npd:download:local] ${pkg.displayName} rmdir local tmp dir: ${dir} error: ${err}, ignore it`)
    );
  }
}
