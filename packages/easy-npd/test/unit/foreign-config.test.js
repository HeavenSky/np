'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const helper = require('../support/helper');
const foreignConfig = require('../../lib/foreign_config');

describe('test/unit/foreign-config.test.js', () => {
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
        JSON.stringify({ pnpm: { onlyBuiltDependencies: ['a'], strictDepBuilds: true } })
      );
      await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'onlyBuiltDependencies:\n  - b\n');
      assert.deepEqual(foreignConfig.pnpm(root), { onlyBuiltDependencies: ['b'], strictDepBuilds: true });
    });

    it('should warn on an invalid pnpm-workspace.yaml', async () => {
      await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'a: [\n');
      const warnings = [];
      assert.deepEqual(foreignConfig.pnpm(root, { warn: (...args) => warnings.push(args.join(' ')) }), {});
      assert.equal(warnings.length, 1);
    });
  });
});
