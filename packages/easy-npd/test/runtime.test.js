const assert = require('node:assert');
const path = require('node:path');
const runtime = require('../lib/runtime');

describe('test/runtime.test.js', () => {
  it('should use the newest node-gyp on supported Node.js', () => {
    assert.equal(runtime.degraded('v22.9.0'), null);
    assert.equal(runtime.warningMessage('v26.0.0'), null);
    assert(runtime.nodeGypBin('v20.17.0').includes(`${path.sep}node-gyp${path.sep}bin`));
  });

  it('should fall back to node-gyp 10 and explain how to restore', () => {
    assert(runtime.nodeGypBin('v16.14.0').includes(`${path.sep}node-gyp10${path.sep}bin`));
    assert(runtime.nodeGypBin('v20.16.0').includes(`${path.sep}node-gyp10${path.sep}bin`));
    const message = runtime.warningMessage('v18.20.8');
    assert.match(message, /^np\w? WARN Node v18\.20\.8: node-gyp 10 .*, upgrade to Node >= 20\.17\.0 to restore$/);
  });

  it('should keep the modern range equal to node-gyp engines', () => {
    assert.equal(runtime.CAPABILITIES.nodeGyp.modern.range, require('node-gyp/package.json').engines.node);
  });
});
