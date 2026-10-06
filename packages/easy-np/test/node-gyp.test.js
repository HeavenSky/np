const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const helper = require('./helper');

const shim = path.join(__dirname, '../node-gyp-bin/node-gyp.js');

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [shim, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('test/node-gyp.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const cacheDir = path.join(tmp, 'cache');
  const installDir = path.join(cacheDir, 'np-node-gyp');

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install node-gyp on first use and reuse it afterwards', async () => {
    const first = await run(['--version'], { np_cache: cacheDir });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /^v\d+\.\d+\.\d+\S*\n$/);
    assert.match(first.stderr, /np installing /);
    assert(fs.existsSync(path.join(installDir, `${process.version}.json`)));

    const second = await run(['--version'], { np_cache: cacheDir });
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.doesNotMatch(second.stderr, /np installing /);
  });

  it('should run the node-gyp that npm_config_node_gyp points to', async () => {
    const fake = path.join(tmp, 'fake-node-gyp.js');
    fs.writeFileSync(fake, "console.log('fake node-gyp %s', process.argv.slice(2).join(' '));\n");
    const result = await run(['rebuild', '--release'], { np_cache: cacheDir, npm_config_node_gyp: fake });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, 'fake node-gyp rebuild --release\n');
    assert(!fs.existsSync(installDir));
  });

  it('should explain how to install node-gyp manually when installing fails', async () => {
    const result = await run(['--version'], {
      np_cache: cacheDir,
      npm_config_registry: 'http://127.0.0.1:1',
      // 指向自身的 npm_config_node_gyp 被忽略, 否则会递归调用
      npm_config_node_gyp: shim,
    });
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /npm i -g node-gyp/);
    assert.deepEqual(fs.readdirSync(installDir), []);
  });
});
