const debug = require('node:util').debuglog('np:get');
const urlParser = require('node:url');
const urllib = require('urllib');
const chalk = require('chalk');
const destroy = require('destroy');
const CacheableLookup = require('cacheable-lookup');
const utils = require('./utils');
const cnpmConfig = require('./cnpm_config');

module.exports = get;

const USER_AGENT = 'easy-np/' + require('../package.json').version + ' ' + urllib.USER_AGENT;
const MAX_RETRY = 5;
const cacheable = new CacheableLookup();
const httpclient = new urllib.HttpClient({
  lookup: cacheable.lookup,
});

async function get(url, options, globalOptions, hasCache = false) {
  options.headers = options.headers || {};
  options.headers['User-Agent'] = USER_AGENT;
  // 不传 rejectUnauthorized / proxy / enableProxy: urllib 3 均不支持, 传入不生效
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
      const registryUrl = cnpmConfig.get('registry');
      const registryUri = registryUrl && registryUrl.replace(urlParser.parse(registryUrl).protocol, '') || '';
      const authed = registryUri && url.indexOf(registryUri) !== -1;
      const hasUserSettings = typeof cnpmConfig.get(registryUri + ':username') === 'string' && typeof cnpmConfig.get(registryUri + ':_password') === 'string';
      if (hasUserSettings && (authed || cnpmConfig.get(registryUri + ':always-auth') || cnpmConfig.get('always-auth'))) {
        const authToken = (`${cnpmConfig.get(registryUri + ':username')}:${Buffer.from(cnpmConfig.get(registryUri + ':_password'), 'base64').toString()}`);
        options.headers.Authorization = `Basic ${Buffer.from(authToken).toString('base64')}`;
      }
    }
  }

  const retry = options.retry || options.retry === 0 ? options.retry : MAX_RETRY;
  options.retry = undefined;
  debug('GET %s with headers: %j, hasCache: %s', url, options.headers, hasCache);
  const result = await _get(url, options, retry, globalOptions, hasCache);
  debug('Response %s, headers: %j', result.status, result.headers);
  if (result.status < 100 || result.status >= 400) {
    if (options.streaming) {
      try {
        destroy(result.res);
      } catch (err) {
        const logger = globalOptions && globalOptions.console || console;
        logger.warn('[np:get] ignore destroy response stream error: %s', err);
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
    return await httpclient.request(url, options);
  } catch (err) {
    retry--;
    const logger = globalOptions && globalOptions.console || console;
    if (retry > 0 && !hasCache) {
      const delay = 100 * (MAX_RETRY - retry);
      (retry === 1 ? logger.warn : debug)('[np:get] retry GET %s after %sms, retry left %s, %s: %s, status: %s, headers: %j',
        url, delay, retry, err.name, err.message, err.status, err.headers);
      await utils.sleep(delay);
      return await _get(url, options, retry, globalOptions);
    }
    logger.warn(chalk.yellow('[np:get:error] GET %s %s: %s after %s reties, status: %s, headers: %j'),
      url, err.name, err.message, MAX_RETRY, err.status, err.headers);
    throw err;
  }
}
