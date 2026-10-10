const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const helper = require('../support/helper');
const foreignConfig = require('../../lib/foreign_config');

describe('test/unit/foreign-config.test.js', () => {
  it('should convert pnpm hoist globs to an anchored regexp', () => {
    const match = (globs, name) => new RegExp(foreignConfig.globsToRegExp(globs), 'i').test(name);
    assert(match(['*eslint*', '*prettier*'], '@typescript-eslint/parser'));
    assert(!match(['*eslint*'], 'react'));
    assert(!match(['*eslint*', '!eslint-plugin-x'], 'eslint-plugin-x'));
    assert(match(['!@types/*'], 'react'));
    assert(!match(['!@types/*'], '@types/node'));
    assert(!match(['a.b'], 'axb'));
    assert.equal(foreignConfig.globsToRegExp([]), null);
  });

  it('should hoist everything with shamefullyHoist or the hoisted node linker', () => {
    assert.equal(foreignConfig.publicHoistPattern({ shamefullyHoist: true, publicHoistPattern: ['x'] }), '.*');
    assert.equal(foreignConfig.publicHoistPattern({ publicHoistPattern: ['x'] }), '^(?:x)$');
    assert.equal(foreignConfig.publicHoistPattern({ nodeLinker: 'hoisted', publicHoistPattern: ['x'] }), '.*');
  });

  it('should convert pnpm build settings to an allowScripts policy', () => {
    assert.deepEqual(
      foreignConfig.pnpmScriptPolicy({
        onlyBuiltDependencies: ['esbuild'],
        ignoredBuiltDependencies: ['core-js'],
        allowBuilds: { sharp: true, bad: 'warn' },
      }),
      { policy: { esbuild: true, 'core-js': false, sharp: true }, allowUnreviewed: false }
    );
    assert.deepEqual(foreignConfig.pnpmScriptPolicy({ neverBuiltDependencies: ['x'] }), {
      policy: { x: false },
      allowUnreviewed: true,
    });
    assert.deepEqual(foreignConfig.pnpmScriptPolicy({}), { policy: null, allowUnreviewed: false });
  });

  it('should read npm_config_* env vars before .npmrc', () => {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `const f = require(${JSON.stringify(require.resolve('../../lib/foreign_config'))}); console.log(f.npmrcFlag('shamefully-hoist'), f.registry())`,
      ],
      { env: { ...process.env, npm_config_shamefully_hoist: 'true', npm_config_registry: 'http://env.test/' } }
    );
    assert.equal(String(out).trim(), 'true http://env.test/');
  });

  describe('pnpm()', () => {
    const [root, cleanup] = helper.tmp();
    beforeEach(cleanup);
    afterEach(cleanup);

    it('should let pnpm-workspace.yaml override the pnpm field of package.json', async () => {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ pnpm: { onlyBuiltDependencies: ['a'], shamefullyHoist: true } })
      );
      await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - b\n');
      assert.deepEqual(foreignConfig.pnpm(root), { onlyBuiltDependencies: ['b'], shamefullyHoist: true });
    });

    it('should warn on an invalid pnpm-workspace.yaml', async () => {
      await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'a: [\n');
      const warnings = [];
      assert.deepEqual(foreignConfig.pnpm(root, { warn: (...args) => warnings.push(args.join(' ')) }), {});
      assert.equal(warnings.length, 1);
    });
  });
});
