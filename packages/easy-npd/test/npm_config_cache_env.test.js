'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/npm_config_cache_env.test.js', () => {
  const [ tmp, cleanup ] = helper.tmp();
  const env = Object.assign({}, process.env, { HOME: tmp });
  delete env.npm_config_cache;
  delete env.npd_cache;

  beforeEach(async () => {
    await cleanup();
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      scripts: {
        postinstall: 'node -e "require(\'fs\').writeFileSync(\'.tmp_npm_config_cache\', process.env.npm_config_cache || \'\')"',
      },
    }));
  });
  afterEach(cleanup);

  async function readScriptCache() {
    return await fs.readFile(path.join(tmp, '.tmp_npm_config_cache'), 'utf8');
  }

  it('should set npm_config_cache to the tarball cache dir for scripts', async () => {
    await coffee.fork(helper.npminstall, [], { cwd: tmp, env })
      .debug()
      .expect('code', 0)
      .end();
    assert.equal(await readScriptCache(), path.join(tmp, '.npd_tarball'));
  });

  it('should still set npm_config_cache with --no-cache', async () => {
    await coffee.fork(helper.npminstall, [ '--no-cache' ], { cwd: tmp, env })
      .debug()
      .expect('code', 0)
      .end();
    assert.equal(await readScriptCache(), path.join(tmp, '.npd_tarball'));
  });
});
