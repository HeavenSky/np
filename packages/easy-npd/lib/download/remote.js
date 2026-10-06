'use strict';

const path = require('path');
const { Transform } = require('stream');
const { randomUUID, createHash } = require('crypto');
const chalk = require('chalk');
const utils = require('../utils');

module.exports = async (pkg, options) => {
  if (options.offline) {
    throw new Error(`Can't install ${pkg.raw} in offline mode: remote packages are always fetched from the network`);
  }
  const { name, raw, fetchSpec, displayName } = pkg;

  // np-lock.json 记录 tarball 的 integrity; 冻结时缺少条目直接报错
  const locked = options.cache.dependenciesTree[raw];
  if (!locked && options.frozenLockfile) {
    throw new Error(`${raw} is not in np-lock.json, run npd without --frozen-lockfile to update it`);
  }
  options.remotePackages++;
  const remoteUrl = fetchSpec;
  options.console.warn(
    chalk.yellow(`[${displayName}] install ${name || ''} from remote ${remoteUrl}, may be very slow, please be patient`)
  );
  const response = await utils.getTarballStream(remoteUrl, options);
  // 经 Transform 计算 integrity: unpack 会摘下并重发首个 data 事件, 直接在响应流上监听会重复计算且可能卡住
  const hash = createHash('sha512');
  const readstream = response.pipe(
    new Transform({
      transform(chunk, encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    })
  );
  response.on('error', err => readstream.destroy(err));
  const ungzipDir = path.join(options.storeDir, '.tmp', randomUUID());
  await utils.mkdirp(ungzipDir);
  try {
    await utils.unpack(readstream, ungzipDir, pkg);
    // 同一个 url 的内容被替换时报错, 不静默装上与锁定时不同的代码
    const integrity = `sha512-${hash.digest('base64')}`;
    const lockedIntegrity = locked && locked.dist && locked.dist.integrity;
    if (lockedIntegrity && lockedIntegrity !== integrity) {
      throw new Error(
        `integrity mismatch for ${remoteUrl}: np-lock.json has ${lockedIntegrity} but got ${integrity}, ` +
          'remove the entry from np-lock.json to accept the new content'
      );
    }
    await utils.addMetaToJSONFile(path.join(ungzipDir, 'package.json'), {
      _from: name ? `${name}@${remoteUrl}` : remoteUrl,
      _resolved: remoteUrl,
    });
    const res = await utils.copyInstall(ungzipDir, options);
    if (name && name !== res.package.name) {
      throw new Error(`Invalid Package, expected ${name} but found ${res.package.name}`);
    }
    // record package name
    options.remoteNames[raw] = res.package.name;
    if (options.lockPackages) {
      options.lockPackages[raw] = { ...res.package, dist: { tarball: remoteUrl, integrity } };
    }
    return res;
  } catch (err) {
    throw new Error(`[${displayName}] ${err.message}`);
  } finally {
    // clean up
    try {
      await utils.rimraf(ungzipDir);
    } catch (err) {
      options.console.warn(chalk.yellow(`rmdir remote ungzip dir: ${ungzipDir} error: ${err}, ignore it`));
    }
  }
};
