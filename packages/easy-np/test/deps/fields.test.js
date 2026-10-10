const dependencies = require('../../lib/dependencies');
const assert = require('node:assert');
const Nested = require('../../lib/nested');

describe('test/deps/fields.test.js', () => {
  const nested = new Nested([]);
  it('should work with dependencies and devDependencies', () => {
    const pkg = {
      dependencies: {
        koa: '1',
        express: '2',
      },
      devDependencies: {
        connect: '3',
        egg: '4',
        koa: '5',
      },
    };

    const parsed = dependencies(pkg, {}, nested);
    assert.deepEqual(parsed.all, [
      { name: 'koa', version: '1', optional: false },
      { name: 'express', version: '2', optional: false },
      { name: 'connect', version: '3', optional: false },
      { name: 'egg', version: '4', optional: false },
    ]);
    assert.deepEqual(parsed.allMap, { koa: '1', express: '2', connect: '3', egg: '4' });
    assert.deepEqual(parsed.prod, [
      { name: 'koa', version: '1', optional: false },
      { name: 'express', version: '2', optional: false },
    ]);
    assert.deepEqual(parsed.prodMap, { koa: '1', express: '2' });
  });

  it('should work with dependencies, devDependencies and optionalDependencies', () => {
    const pkg = {
      dependencies: {
        koa: '1',
        express: '2',
      },
      devDependencies: {
        connect: '3',
        egg: '4',
        koa: '5',
      },
      optionalDependencies: {
        express: '3',
        hapi: '1',
      },
    };

    const parsed = dependencies(pkg, {}, nested);
    assert.deepEqual(parsed.all, [
      { name: 'koa', version: '1', optional: false },
      { name: 'express', version: '3', optional: true },
      { name: 'hapi', version: '1', optional: true },
      { name: 'connect', version: '3', optional: false },
      { name: 'egg', version: '4', optional: false },
    ]);
    assert.deepEqual(parsed.allMap, { koa: '1', express: '3', connect: '3', egg: '4', hapi: '1' });
    assert.deepEqual(parsed.prod, [
      { name: 'koa', version: '1', optional: false },
      { name: 'express', version: '3', optional: true },
      { name: 'hapi', version: '1', optional: true },
    ]);
    assert.deepEqual(parsed.prodMap, { koa: '1', express: '3', hapi: '1' });
  });

  it('should ignore optionalDependencies', () => {
    const pkg = {
      dependencies: {
        koa: '1',
        express: '2',
      },
      devDependencies: {
        connect: '3',
        egg: '4',
        koa: '5',
      },
      optionalDependencies: {
        express: '3',
        hapi: '1',
      },
    };

    const parsed = dependencies(pkg, { ignoreOptionalDependencies: true }, nested);
    assert.deepEqual(parsed.all, [
      { name: 'koa', version: '1', optional: false },
      { name: 'connect', version: '3', optional: false },
      { name: 'egg', version: '4', optional: false },
    ]);
    assert.deepEqual(parsed.allMap, { koa: '1', connect: '3', egg: '4' });
    assert.deepEqual(parsed.prod, [{ name: 'koa', version: '1', optional: false }]);
    assert.deepEqual(parsed.prodMap, { koa: '1' });
  });

  it('should only install the listed fields with rootFields', () => {
    const pkg = {
      dependencies: { koa: '1', express: '2' },
      optionalDependencies: { express: '3' },
      devDependencies: { mocha: '3', koa: '9' },
      clientDependencies: { react: '3', koa: '9' },
    };

    assert.deepEqual(dependencies(pkg, {}, nested, ['dependencies']).prodMap, { koa: '1', express: '2' });
    const parsed = dependencies(pkg, {}, nested, [
      'dependencies',
      'optionalDependencies',
      'devDependencies',
      'clientDependencies',
    ]);
    // optionalDependencies 覆盖 dependencies, 其余字段同名时取先选中的
    assert.deepEqual(parsed.allMap, { express: '3', koa: '1', react: '3', mocha: '3' });
    assert.deepEqual(parsed.prodMap, parsed.allMap);
    assert.deepEqual(
      parsed.prod.map(item => [item.name, item.optional]),
      [
        ['express', true],
        ['koa', false],
        ['react', false],
        ['mocha', false],
      ]
    );
    assert.deepEqual(dependencies(pkg, {}, nested, ['clientDependencies']).allMap, { react: '3', koa: '9' });
  });
});
