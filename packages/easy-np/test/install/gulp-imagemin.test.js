const assert = require('node:assert');
const path = require('node:path');
const readJSON = require('../../lib/utils').readJSON;
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

describe('test/install/gulp-imagemin.test.js', () => {
  const root = helper.fixtures('gulp-imagemin');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install local folder ok', async () => {
    await npminstall({
      root,
    });
    const pkg = await readJSON(path.join(root, 'node_modules/gulp-imagemin/package.json'));
    assert.equal(pkg.name, 'gulp-imagemin');
  });
});
