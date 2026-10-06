const debug = require('node:util').debuglog('np:download:local');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const chalk = require('chalk');
const utils = require('../utils');

module.exports = async (pkg, options) => {
  const { fetchSpec, displayName } = pkg;
  options.localPackages++;
  let filepath = fetchSpec;

  try {
    filepath = await fs.realpath(filepath);
    const stat = await fs.stat(filepath);
    // _scriptsOwner 为 undefined 时删掉包内自带的同名字段, 否则受信本地包可冒充其他包的放行身份
    const meta = { _from: pkg.raw, _resolved: `file:${filepath}`, _scriptsOwner: pkg.scriptsOwner };
    return stat.isDirectory()
      ? await localFolder(filepath, pkg, options, meta)
      : await localTarball(filepath, pkg, options, meta);
  } catch (err) {
    throw new Error(`[${displayName}] resolved target ${filepath} error: ${err.message}`);
  }
};

async function localFolder(filepath, pkg, options, meta) {
  debug(`install ${pkg.name}@${pkg.rawSpec} from local folder ${filepath}`);
  try {
    // everytime copy to a different directory to avoid parallel install
    const tmpDir = path.join(options.storeDir, '.tmp', randomUUID());
    await utils.mkdirp(tmpDir);
    // use npm pack to ensure npmignore/gitignore/package.files work fine
    const ignoreScripts = pkg.untrustedLocal || options.ignoreScripts ? ' --ignore-scripts' : '';
    const res = await utils.exec(`npm pack --pack-destination ${tmpDir}${ignoreScripts}`, { cwd: filepath });
    if (res && res.stdout) {
      const tarball = path.join(tmpDir, res.stdout.trim());
      try {
        return await localTarball(tarball, pkg, options, meta);
      } finally {
        await utils.rimraf(tarball);
      }
    }
  } catch (err) {
    // fallback to copy
    options.console.warn(
      `[np:download:local] install ${pkg.displayName} from local folder ${filepath} with npm pack failed(${err.message}), use copy`
    );
    const res = await utils.copyInstall(filepath, options);
    if (!res.exists) {
      await utils.addMetaToJSONFile(path.join(res.dir, 'package.json'), meta);
      Object.assign(res.package, meta);
    }
    return res;
  }
}

async function localTarball(filepath, pkg, options, meta) {
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
          `[np:download:local] ${pkg.displayName} rmdir local ungzip dir: ${ungzipDir} error: ${err}, ignore it`
        )
      );
    }
  }
}
