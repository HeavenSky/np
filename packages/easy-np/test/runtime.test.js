const assert = require('node:assert');
const runtime = require('../lib/runtime');

describe('test/runtime.test.js', () => {
  it('should install the newest node-gyp on supported Node.js', () => {
    assert.equal(runtime.degraded('v22.9.0'), null);
    assert.equal(runtime.warningMessage('v26.0.0'), null);
    assert.deepEqual(runtime.nodeGypPackage('v20.17.0'), { name: 'node-gyp', spec: 'node-gyp' });
  });

  it('should pick an older node-gyp on older Node.js and explain how to restore', () => {
    for (const version of ['v16.14.0', 'v18.20.8', 'v20.16.0', 'v22.8.0']) {
      assert.deepEqual(runtime.nodeGypPackage(version), { name: 'node-gyp', spec: 'node-gyp' }, version);
    }
    const legacy = { name: '@electron/node-gyp', spec: '@electron/node-gyp@^10.2.0-electron.2' };
    for (const version of ['v14.18.0', 'v16.13.2', 'v17.9.1']) {
      assert.deepEqual(runtime.nodeGypPackage(version), legacy, version);
    }
    for (const version of ['v14.18.0', 'v18.20.8']) {
      const message = runtime.warningMessage(version);
      assert.match(
        message,
        /^np\w? WARN Node v\d+\.\d+\.\d+: node-gyp < 12 .*, upgrade to Node >= 20\.17\.0 to restore$/
      );
    }
  });

  it('should compute the lowest higher version that restores every capability', () => {
    const range = runtime.CAPABILITIES.nodeGyp.modern.range;
    for (const version of ['14.18.0', '18.20.8', '20.16.0']) {
      assert.equal(runtime.restoreVersion([range], version), '20.17.0', version);
    }
    for (const version of ['21.7.3', '22.0.0', '22.8.0', '22.9.0-pre']) {
      assert.equal(runtime.restoreVersion([range], version), '22.9.0', version);
    }
    assert.equal(runtime.restoreVersion(['^20.17.0'], '21.0.0'), null);
    assert.match(runtime.warningMessage('v21.7.3'), /, upgrade to Node >= 22\.9\.0 to restore$/);
    assert.match(runtime.warningMessage('v22.9.0-pre'), /, upgrade to Node >= 22\.9\.0 to restore$/);
  });

  it('should provide the built-ins tar 7 calls', () => {
    assert.equal('a\\b\\c'.replaceAll(/\\/g, '/'), 'a/b/c');
    assert.equal('a.b.c'.replaceAll('.', '$&$&'), 'a..b..c');
    assert.equal([1, 2, 3].at(-1), 3);
    assert.equal([1, 2, 3].at(0), 1);
    assert.equal([].at(-1), undefined);
  });
});
