'use strict';

const coffee = require('coffee');
const helper = require('./helper');

describe('test/install-without-userconfig.test.js', () => {
  const cwd = helper.fixtures('initial-nprc');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should run npd install successfully without .nprc userconfig', async () => {
    await coffee
      .fork(helper.npminstall, ['webpack-parallel-uglify-plugin@1.0.0'], {
        cwd,
        env: Object.assign({}, process.env, {
          USERPROFILE: cwd,
          HOME: cwd,
        }),
      })
      .debug()
      .expect('code', 0)
      .end();
  });
});
