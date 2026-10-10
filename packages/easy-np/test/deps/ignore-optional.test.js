const assert = require('node:assert');
const path = require('node:path');
const coffee = require('coffee');
const { rimraf, exists } = require('../../lib/utils');
const npminstall = path.join(__dirname, '../../bin/i.js');

describe('test/deps/ignore-optional.test.js', () => {
  let cwd;
  async function cleanup() {
    if (cwd) await rimraf(path.join(cwd, 'node_modules'));
    cwd = null;
  }

  before(cleanup);
  after(cleanup);

  it('should install ignore optionalDependencies', async () => {
    cwd = path.join(__dirname, '../fixtures', 'ignore-optional');
    await coffee
      .fork(npminstall, ['--omit=optional', '--production', '--detail'], { cwd })
      .debug()
      .notExpect('stderr', /node-gyp rebuild/)
      .expect('stdout', /pinyin@2.8.3 installed/)
      .expect('code', 0)
      .end();
    const e = await exists(path.join(cwd, 'node_modules/pinyin/node_modules/nodejieba'));
    assert(!e);
  });
});
