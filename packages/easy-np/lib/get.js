const debug = require('node:util').debuglog('np:get');
const urlParser = require('node:url');
const urllib = require('urllib');
const chalk = require('chalk');
const destroy = require('destroy');
const CacheableLookup = require('cacheable-lookup');
const utils = require('./utils');
const npConfig = require('./np_config');
const proxy = require('./proxy');

module.exports = get;

const USER_AGENT = 'easy-np/' + require('../package.json').version + ' ' + urllib.USER_AGENT;
const MAX_RETRY = 5;
const cacheable = new CacheableLookup();
// strict-ssl / cafile 由 CLI 在首个请求前写入 proxy 配置, 客户端要在那之后创建
let httpclient;
function getHttpClient() {
  if (!httpclient) {
    const tls = proxy.tlsOptions();
    httpclient = new urllib.HttpClient({ lookup: cacheable.lookup, ...(tls && { connect: tls }) });
  }
  return httpclient;
}

// 公共源逐个尝试的总次数: 测速最快的 3 个源按先后各 2 次
const MIRROR_ATTEMPTS = 6;
get.MIRROR_ATTEMPTS = MIRROR_ATTEMPTS;
// 安装脚本在二进制镜像与官方地址之间交替重跑的总次数: 两个源各 2 次
get.BINARY_ATTEMPTS = 4;

async function get(url, options, globalOptions, hasCache = false) {
  if (options.mirrorUrls && options.mirrorUrls.length > 1) {
    return await getFromMirrors(options, globalOptions);
  }
  options.headers = options.headers || {};
  options.headers['User-Agent'] = USER_AGENT;
  if (globalOptions?.referer) {
    options.headers.Referer = globalOptions.referer;
  }
  if (!options.headers.Authorization) {
    // need auth
    if (globalOptions?.registryAuthorization) {
      // token 只发给与 registry 同 host 的请求, 去掉该判断会把 token 泄露给 tarball CDN 与备用 registry
      if (isSameHost(url, globalOptions.registry)) {
        options.headers.Authorization = `Bearer ${globalOptions.registryAuthorization}`;
      }
    } else {
      // the old style, use user and password
      const registryUrl = npConfig.get('registry');
      const registryUri = (registryUrl && registryUrl.replace(urlParser.parse(registryUrl).protocol, '')) || '';
      const hasUserSettings =
        typeof npConfig.get(registryUri + ':username') === 'string' &&
        typeof npConfig.get(registryUri + ':_password') === 'string';
      // 凭据只发给与 registry 同 host 的请求, always-auth 也不例外; 放宽会把凭据泄露给备用 registry, tarball CDN 与二进制镜像
      if (hasUserSettings && isSameHost(url, registryUrl)) {
        const authToken = `${npConfig.get(registryUri + ':username')}:${Buffer.from(npConfig.get(registryUri + ':_password'), 'base64').toString()}`;
        options.headers.Authorization = `Basic ${Buffer.from(authToken).toString('base64')}`;
      }
    }
  }

  const retry = options.retry || options.retry === 0 ? options.retry : MAX_RETRY;
  options.retry = undefined;
  debug('GET %s with headers: %j, hasCache: %s', utils.redactUrl(url), utils.redact(options.headers), hasCache);
  const result = await _get(url, options, retry, globalOptions, hasCache);
  debug('Response %s, headers: %j', result.status, result.headers);
  if (result.status < 100 || result.status >= 400) {
    if (options.streaming) {
      try {
        // 主动断开响应流会触发 abort 错误, 不监听会成为未捕获异常
        result.res.on('error', () => {});
        destroy(result.res);
      } catch (err) {
        const logger = (globalOptions && globalOptions.console) || console;
        logger.warn('[np:get] ignore destroy response stream error: %s', err);
      }
    }
    let message = `GET ${utils.redactUrl(url)} response ${result.status} status`;
    if (result.headers && result.headers['npm-notice']) {
      message += `, ${result.headers['npm-notice']}`;
    }
    const err = new Error(message);
    err.status = result.status;
    throw err;
  }
  return result;
}

// 按 mirrorUrls 的先后循环尝试, 4xx / 5xx 也换源: 镜像同步滞后时新版本在镜像上是 404
async function getFromMirrors(options, globalOptions) {
  const { mirrorUrls, ...requestOptions } = options;
  let lastErr;
  for (let i = 0; i < MIRROR_ATTEMPTS; i++) {
    const url = mirrorUrls[i % mirrorUrls.length];
    try {
      // 每次复制请求头再按本次 url 判断是否附加凭据, 避免把一个源的凭据带给另一个源
      return await get(
        url,
        { ...requestOptions, headers: { ...requestOptions.headers }, retry: 1 },
        globalOptions,
        true
      );
    } catch (err) {
      lastErr = err;
      debug('mirror attempt %s GET %s error: %s', i + 1, utils.redactUrl(url), utils.redactUrl(err.message));
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

async function _get(url, options, retry, globalOptions, hasCache) {
  try {
    // let mock agent easy for unittest
    if (process.env.MOCK_AGENT) {
      return await urllib.request(url, options);
    }
    const dispatcher = proxy.dispatcherFor(url);
    return await getHttpClient().request(url, dispatcher ? { ...options, dispatcher } : options);
  } catch (err) {
    retry--;
    const logger = (globalOptions && globalOptions.console) || console;
    if (retry > 0 && !hasCache) {
      const delay = 100 * (MAX_RETRY - retry);
      (retry === 1 ? logger.warn : debug)(
        '[np:get] retry GET %s after %sms, retry left %s, %s: %s, status: %s, headers: %j',
        utils.redactUrl(url),
        delay,
        retry,
        err.name,
        utils.redactUrl(err.message),
        err.status,
        err.headers
      );
      await utils.sleep(delay);
      return await _get(url, options, retry, globalOptions);
    }
    logger.warn(
      chalk.yellow('[np:get:error] GET %s %s: %s after %s retries, status: %s, headers: %j'),
      utils.redactUrl(url),
      err.name,
      utils.redactUrl(err.message),
      MAX_RETRY,
      err.status,
      err.headers
    );
    throw err;
  }
}
