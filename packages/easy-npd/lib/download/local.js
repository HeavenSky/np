'use strict';

const debug = require('debug')('npd:download:local');
const { randomUUID } = require('crypto');
const fs = require('fs/promises');
const { createReadStream } = require('fs');
const path = require('path');
const chalk = require('chalk');
const utils = require('../utils');

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
    return stat.isDirectory()
      ? await localFolder(filepath, pkg, meta, options)
      : await localTarball(filepath, pkg, meta, options);
  } catch (err) {
    throw new Error(`[${displayName}] resolved target ${filepath} error: ${err.message}`);
  }
};

async function localFolder(filepath, pkg, meta, options) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local folder ${filepath}`);
  try {
    // everytime copy to a different directory to avoid parallel install
    const tmpDir = path.join(options.storeDir, '.tmp', randomUUID());
    await utils.mkdirp(tmpDir);
    // use npm pack to ensure npmignore/gitignore/package.files work fine
    // 不受信的本地包只在放行后执行 preinstall / install / postinstall, npm pack 不能执行它的 prepack / prepare
    const ignoreScripts = pkg.untrustedLocal || options.ignoreScripts ? ' --ignore-scripts' : '';
    const res = await utils.exec(`npm pack --pack-destination ${tmpDir}${ignoreScripts}`, { cwd: filepath });
    if (res && res.stdout) {
      const tarball = path.join(tmpDir, res.stdout.trim());
      try {
        return await localTarball(tarball, pkg, meta, options);
      } finally {
        await utils.rimraf(tarball);
      }
    }
  } catch (err) {
    // fallback to copy
    options.console.warn(
      `[npd:download:local] install ${pkg.displayName} from local folder ${filepath} with npm pack failed(${err.message}), use copy`
    );
    const res = await utils.copyInstall(filepath, options);
    if (!res.exists) await utils.addMetaToJSONFile(path.join(res.dir, 'package.json'), meta);
    Object.assign(res.package, meta);
    return res;
  }
}

async function localTarball(filepath, pkg, meta, options) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local tarball ${filepath}`);
  const readstream = createReadStream(filepath);
  // everytime unpack to a different directory
  const ungzipDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(ungzipDir);
  try {
    await utils.unpack(readstream, ungzipDir, pkg);
    const pkgFile = path.join(ungzipDir, 'package.json');
    if (await utils.exists(pkgFile)) await utils.addMetaToJSONFile(pkgFile, meta);
    return await utils.copyInstall(ungzipDir, options);
  } finally {
    // clean up
    try {
      await utils.rimraf(ungzipDir);
    } catch (err) {
      options.console.warn(
        chalk.yellow(
          `[npd:download:local] ${pkg.displayName} rmdir local ungzip dir: ${ungzipDir} error: ${err}, ignore it`
        )
      );
    }
  }
}
