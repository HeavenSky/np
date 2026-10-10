// 后台执行的依赖脚本失败时, 输出写入缓存目录下的 np-script-logs, 报错附上日志路径
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const mm = require('mm');
const helper = require('../support/helper');
const utils = require('../../lib/utils');

describe('test/scripts/script-log.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const script = "node -e \"console.log('out-marker'); console.error('err-marker'); process.exit(3)\"";
  const quiet = { info() {}, log() {}, warn() {}, error() {} };

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(path.join(tmp, 'dep'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'dep/package.json'), JSON.stringify({ name: '@scope/dep', version: '1.2.3' }));
  });
  afterEach(async () => {
    mm.restore();
    await cleanup();
  });

  async function run(globalOptions, foregroundScripts = false) {
    const options = { root: tmp, env: {}, console: quiet, foregroundScripts, ...globalOptions };
    return await assert.rejects(utils.runScript(path.join(tmp, 'dep'), script, options), err => {
      run.err = err;
      return true;
    });
  }

  it('should write the output of a failed background script to the cache dir', async () => {
    await run({ cacheDir: path.join(tmp, 'cache') });
    const logDir = path.join(tmp, 'cache/np-script-logs');
    const [file] = await fs.readdir(logDir);
    assert.match(file, /^\d{8}-\d{6}-@scope\+dep@1\.2\.3-[0-9a-f]{8}\.log$/);
    assert.equal(run.err.logFile, path.join(logDir, file));
    assert(run.err.message.endsWith(`\nscript output: ${run.err.logFile}`), run.err.message);
    assert.equal(run.err.message.split('\n').length, 2, run.err.message);
    const content = await fs.readFile(run.err.logFile, 'utf8');
    assert(content.includes(`cwd: ${path.join(tmp, 'dep')}`));
    assert(content.includes('exit code 3'));
    assert(content.includes('out-marker'));
    assert(content.includes('err-marker'));
  });

  it('should fall back to np_cache without the disk cache', async () => {
    mm(process.env, 'np_cache', path.join(tmp, 'np-cache'));
    await run({ cacheDir: '' });
    assert.equal(path.dirname(run.err.logFile), path.join(tmp, 'np-cache/np-script-logs'));
  });

  it('should remove expired logs and skip logging for foreground scripts', async () => {
    const logDir = path.join(tmp, 'cache/np-script-logs');
    await fs.mkdir(logDir, { recursive: true });
    const old = path.join(logDir, 'old.log');
    await fs.writeFile(old, 'old');
    const time = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.utimes(old, time, time);
    await run({ cacheDir: path.join(tmp, 'cache') });
    assert.deepEqual(await fs.readdir(logDir), [path.basename(run.err.logFile)]);

    await run({ cacheDir: path.join(tmp, 'cache') }, true);
    assert.equal(run.err.logFile, undefined);
    assert.equal((await fs.readdir(logDir)).length, 1);
  });
});
