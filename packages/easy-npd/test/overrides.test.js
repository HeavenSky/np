'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const createResolution = require('../lib/resolution');
const helper = require('./helper');
const { installLocal } = require('..');

function ancestors(...items) {
  return items.map(item => {
    const index = item.lastIndexOf('@');
    return { name: item.slice(0, index), version: item.slice(index + 1) };
  });
}

describe('test/overrides.test.js', () => {
  function create(pkg) {
    const options = { pendingMessages: [] };
    const resolve = createResolution(pkg, options);
    return (name, version, parents) => resolve({ name, version }, parents, {}).version;
  }

  it('should override nested dependencies but not direct dependencies', () => {
    const resolve = create({ overrides: { foo: '1.0.0' } });
    assert.equal(resolve('foo', '^2.0.0', ancestors('bar@1.0.0')), '1.0.0');
    assert.equal(resolve('foo', '^2.0.0', []), '^2.0.0');
    assert.equal(resolve('other', '^2.0.0', ancestors('bar@1.0.0')), '^2.0.0');
  });

  it('should only override when the requested range intersects the key spec', () => {
    const resolve = create({ overrides: { 'foo@^1': '1.2.3', '@scope/foo@^1': '1.0.1' } });
    assert.equal(resolve('foo', '^1.1.0', ancestors('bar@1.0.0')), '1.2.3');
    assert.equal(resolve('foo', '^2.0.0', ancestors('bar@1.0.0')), '^2.0.0');
    assert.equal(resolve('@scope/foo', '~1.0.0', ancestors('bar@1.0.0')), '1.0.1');
  });

  it('should override dependencies anywhere under the parent', () => {
    const resolve = create({ overrides: { foo: '1.0.0', bar: { '.': '3.0.0', foo: '2.0.0' } } });
    assert.equal(resolve('foo', '^1.0.0', ancestors('baz@1.0.0', 'bar@1.0.0', 'qux@1.0.0')), '2.0.0');
    assert.equal(resolve('foo', '^1.0.0', ancestors('baz@1.0.0')), '1.0.0');
    assert.equal(resolve('bar', '^1.0.0', ancestors('baz@1.0.0')), '3.0.0');
  });

  it('should match the parent version spec', () => {
    const resolve = create({ overrides: { 'bar@1': { foo: '2.0.0' } } });
    assert.equal(resolve('foo', '^1.0.0', ancestors('bar@1.5.0')), '2.0.0');
    assert.equal(resolve('foo', '^1.0.0', ancestors('bar@2.0.0')), '^1.0.0');
  });

  it('should resolve $name references to direct dependencies', () => {
    const resolve = create({ dependencies: { foo: '^1.5.0' }, overrides: { foo: '$foo' } });
    assert.equal(resolve('foo', '^1.0.0', ancestors('bar@1.0.0')), '^1.5.0');
    assert.throws(() => create({ overrides: { foo: '$foo' } }), /unable to resolve reference \$foo/);
  });

  describe('install', () => {
    const [tmp, cleanup] = helper.tmp();
    beforeEach(cleanup);
    afterEach(cleanup);

    it('should install the overridden version', async () => {
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { debug: '4.3.4' }, overrides: { ms: '2.1.1' } })
      );
      await installLocal({ root: tmp });
      const debugDir = await fs.realpath(path.join(tmp, 'node_modules/debug'));
      const msPkg = require(require.resolve('ms/package.json', { paths: [debugDir] }));
      assert.equal(msPkg.version, '2.1.1');
    });
  });
});
