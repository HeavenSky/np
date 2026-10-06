'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const helper = require('./helper');
const runtime = require('../lib/runtime');

const shim = path.join(__dirname, '../node-gyp-bin/node-gyp.js');

function nodeGyp(args, env) {
  return spawnSync(process.execPath, [shim, ...args], {
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    env: { ...process.env, ...env },
  });
}

describe('test/node-gyp.test.js', () => {
  const [cache, cleanup] = helper.tmp();
  const cacheDir = path.join(cache, 'npd-node-gyp');
  const { spec } = runtime.nodeGypPackage();

  beforeEach(cleanup);
  after(cleanup);

  it('should install node-gyp on first use and reuse it afterwards', async () => {
    // 中断的安装留下的孤儿目录: 超过一小时的被清理, 可能仍在安装中的保留
    const staleOrphan = `${process.version}-${crypto.randomUUID()}`;
    const freshOrphan = `${process.version}-${crypto.randomUUID()}`;
    await fs.mkdir(path.join(cacheDir, staleOrphan), { recursive: true });
    await fs.mkdir(path.join(cacheDir, freshOrphan), { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(path.join(cacheDir, staleOrphan), twoHoursAgo, twoHoursAgo);

    const first = nodeGyp(['--version'], { np_cache: cache });
    assert.equal(first.status, 0, first.stderr);
    // 原生模块的构建脚本会解析 node-gyp 的 stdout, 安装日志只能出现在 stderr
    assert.match(first.stdout, /^v\d+\.\d+\.\d+\S*\n$/);
    assert(first.stderr.includes(`installing ${spec}`), first.stderr);
    const pointer = JSON.parse(await fs.readFile(path.join(cacheDir, `${process.version}.json`), 'utf8'));
    assert.equal(path.dirname(pointer.dir), cacheDir);

    const second = nodeGyp(['--version'], { np_cache: cache, npm_config_node_gyp: shim });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert(!second.stderr.includes('installing'), second.stderr);
    const entries = (await fs.readdir(cacheDir)).sort();
    assert.deepEqual(entries, [path.basename(pointer.dir), freshOrphan, `${process.version}.json`].sort());
  });

  it('should use npm_config_node_gyp when it points to an existing file', async () => {
    const fake = path.join(cache, 'fake-node-gyp.js');
    await fs.writeFile(fake, "console.log('fake node-gyp %s', process.argv.slice(2).join(' '));\n");
    const result = nodeGyp(['rebuild'], { np_cache: cache, npm_config_node_gyp: fake });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'fake node-gyp rebuild\n');
    assert.equal(result.stderr, '');
  });

  it('should exit 1 with a manual install hint when the install fails', async () => {
    const result = nodeGyp(['--version'], { np_cache: cache, npm_config_registry: 'http://127.0.0.1:1' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert(result.stderr.includes(`npm i -g ${spec}`), result.stderr);
    assert(result.stderr.includes('npm_config_node_gyp'), result.stderr);
    assert.deepEqual(await fs.readdir(cacheDir), []);
  });
});
