'use strict';

const Conext = require('../../lib/context');
const assert = require('assert');

describe('test/unit/context.test.js', () => {
  it('should context work', () => {
    const context = new Conext();

    assert(context.nested);
    assert(context.nested.depMap);
  });
});
