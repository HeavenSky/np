'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/rootpath.test.js', () => {
  const cwd = helper.fixtures('rootpath');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should run preinstall and postinstall', () => {
    return coffee
      .fork(helper.npminstall, ['-d'], { cwd })
      .debug()
      .expect('code', 0)
      .expect('stdout', /hello process\.env\.npm_rootpath is true/)
      .end();
  });

  describe('repeated --root', () => {
    const [tmp, tmpCleanup] = helper.tmp();
    beforeEach(async () => {
      await tmpCleanup();
      await fs.mkdir(path.join(tmp, 'lib'), { recursive: true });
      await fs.writeFile(path.join(tmp, 'lib/package.json'), JSON.stringify({ name: 'lib', version: '1.0.0' }));
      await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
    });
    after(() => fs.rm(tmp, { recursive: true, force: true }));

    it('should use the last --root like npm', async () => {
      await coffee
        .fork(helper.npminstall, ['--root=not-exists', `--root=${tmp}`, 'file:./lib'], { cwd })
        .expect('code', 0)
        .end();
      const pkg = await helper.readJSON(path.join(tmp, 'node_modules/lib/package.json'));
      assert.equal(pkg.version, '1.0.0');
    });
  });
});
