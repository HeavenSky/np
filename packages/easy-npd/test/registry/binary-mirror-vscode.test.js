'use strict';

const path = require('path');
const coffee = require('coffee');
const fs = require('fs/promises');
const assert = require('assert');
const helper = require('../support/helper');

describe('test/registry/binary-mirror-vscode.test.js', () => {
  const cwd = helper.fixtures('install-vscode');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install vscode version on dependencies', async () => {
    await coffee
      .fork(helper.npminstall, ['-d'], { cwd, env: { ...process.env, NPD_TEST_LOCAL_PKG: '1' } })
      .debug()
      .expect('code', 0)
      .expect('stdout', /All packages installed/)
      .end();
    const installFile = path.join(cwd, 'node_modules/vscode/bin/install');
    const content = await fs.readFile(installFile, 'utf8');
    assert(content.includes('process.env.npm_package_engines_vscode'));
  });
});
