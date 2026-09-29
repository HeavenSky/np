const debug = require('debug')('npd:get');
const urllib = require('urllib');
const destroy = require('destroy');
const CacheableLookup = require('cacheable-lookup');
const utils = require('./utils');
const cnpmConfig = require('./cnpm_config');
const urlParser = require('url');

module.exports = get;

const USER_AGENT = 'easy-npd/' + require('../package.json').version + ' ' + urllib.USER_AGENT;
const MAX_RETRY = 5;
const cacheable = new CacheableLookup();
const httpclient = new urllib.HttpClient({
  lookup: cacheable.lookup,
});

// 公共源交替尝试的总次数: 两个源各 2 次
const MIRROR_ATTEMPTS = 4;
get.MIRROR_ATTEMPTS = MIRROR_ATTEMPTS;

async function get(url, options, globalOptions) {
  if (options.mirrorUrls && options.mirrorUrls.length > 1) {
    return await getFromMirrors(options, globalOptions);
  }
  options.headers = options.headers || {};
  options.headers['User-Agent'] = USER_AGENT;
  // 不传 rejectUnauthorized / proxy / enableProxy: urllib 3 均不支持, 传入不生效
  if (globalOptions && globalOptions.referer) {
    options.headers.Referer = globalOptions.referer;
  }
  // need auth
  const registryUrl = cnpmConfig.get('registry');
  const registryUri = (registryUrl && registryUrl.replace(urlParser.parse(registryUrl).protocol, '')) || '';
  const hasUserSettings =
    typeof cnpmConfig.get(registryUri + ':username') === 'string' &&
    typeof cnpmConfig.get(registryUri + ':_password') === 'string';
  // 凭据只发给与 registry 同 host 的请求, always-auth 也不例外; 放宽会把凭据泄露给备用 registry, tarball CDN 与二进制镜像
  if (hasUserSettings && isSameHost(url, registryUrl)) {
    const authToken = `${cnpmConfig.get(registryUri + ':username')}:${Buffer.from(cnpmConfig.get(registryUri + ':_password'), 'base64').toString()}`;
    options.headers.Authorization = `Basic ${Buffer.from(authToken).toString('base64')}`;
  }
  const retry = options.retry || options.retry === 0 ? options.retry : MAX_RETRY;
  options.retry = undefined;
  debug('GET %s with headers: %j', url, options.headers);
  const result = await _get(url, options, retry, globalOptions);
  debug('Response %s, headers: %j', result.status, result.headers);
  if (result.status < 100 || result.status >= 400) {
    if (options.streaming) {
      try {
        // 主动断开响应流会触发 abort 错误, 不监听会成为未捕获异常
        result.res.on('error', () => {});
        destroy(result.res);
      } catch (err) {
        const logger = (globalOptions && globalOptions.console) || console;
        logger.warn('[npd:get] ignore destroy response stream error: %s', err);
      }
    }
    let message = `GET ${url} response ${result.status} status`;
    if (result.headers && result.headers['npm-notice']) {
      message += `, ${result.headers['npm-notice']}`;
    }
    const err = new Error(message);
    err.status = result.status;
    throw err;
  }
  return result;
}

// 按 mirrorUrls 的先后交替尝试, 4xx / 5xx 也换源: 镜像同步滞后时新版本在镜像上是 404
async function getFromMirrors(options, globalOptions) {
  const { mirrorUrls, ...requestOptions } = options;
  let lastErr;
  for (let i = 0; i < MIRROR_ATTEMPTS; i++) {
    const url = mirrorUrls[i % mirrorUrls.length];
    try {
      // 每次复制请求头再按本次 url 判断是否附加凭据, 避免把一个源的凭据带给另一个源
      return await get(url, { ...requestOptions, headers: { ...requestOptions.headers }, retry: 1 }, globalOptions);
    } catch (err) {
      lastErr = err;
      debug('mirror attempt %s GET %s error: %s', i + 1, url, err.message);
    }
  }
  throw lastErr;
}

function isSameHost(url, registry) {
  try {
    return new URL(url).host === new URL(registry).host;
  } catch {
    return false;
  }
}

async function _get(url, options, retry, globalOptions) {
  try {
    // let mock agent easy for unittest
    if (process.env.MOCK_AGENT) {
      return await urllib.request(url, options);
    }
    return await httpclient.request(url, options);
  } catch (err) {
    retry--;
    if (retry > 0) {
      const delay = 100 * (MAX_RETRY - retry);
      const logger = (globalOptions && globalOptions.console) || console;
      logger.warn(
        '[npd:get] retry GET %s after %sms, retry left %s, %s: %s, status: %s, headers: %j',
        url,
        delay,
        retry,
        err.name,
        err.message,
        err.status,
        err.headers
      );
      await utils.sleep(delay);
      return await _get(url, options, retry, globalOptions);
    }

    throw err;
  }
}
