const Conext = require('../../lib/context');
const assert = require('node:assert');

describe('test/unit/context.test.js', () => {
  it('should context work', () => {
    const context = new Conext();

    assert(context.nested);
    assert(context.nested.depMap);
  });
});
