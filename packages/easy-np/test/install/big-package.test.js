const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

describe('test/install/big-package.test.js', () => {
  function testcase(name) {
    describe(name, () => {
      const root = helper.fixtures(name);
      const cleanup = helper.cleanup(root);

      beforeEach(cleanup);
      afterEach(cleanup);

      it('should install success', async () => {
        if (process.platform === 'win32') return;
        await npminstall({
          root,
          trace: true,
        });
      });
    });
  }

  ['alotta-files'].forEach(testcase);
});
