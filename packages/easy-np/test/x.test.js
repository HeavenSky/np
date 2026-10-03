const path = require('node:path');
const coffee = require('coffee');

const x = path.join(__dirname, '../bin/x.js');

describe('test/x.test.js', () => {
  it('should list commands with -h', async () => {
    await coffee
      .fork(x, ['-h'])
      .expect('stdout', /Commands:/)
      .expect('stdout', /install, i, add/)
      .expect('stdout', /rebuild, rb/)
      .expect('code', 0)
      .end();
  });

  it('should list commands and fail without a command or with an unknown command', async () => {
    await coffee
      .fork(x, [])
      .expect('stdout', /Commands:/)
      .expect('code', 1)
      .end();
    await coffee
      .fork(x, ['nope'])
      .expect('stderr', /np-x: unknown command "nope"/)
      .expect('code', 1)
      .end();
  });

  it('should show help of a command by name, alias or help <command>', async () => {
    await coffee
      .fork(x, ['rb', '-h'])
      .expect('stdout', /np-x rebuild <pkg>/)
      .expect('code', 0)
      .end();
    await coffee
      .fork(x, ['help', 'un'])
      .expect('stdout', /np-x uninstall <pkg>/)
      .expect('code', 0)
      .end();
    await coffee
      .fork(x, ['ln', '--help'])
      .expect('stdout', /np-x link <folder>/)
      .expect('code', 0)
      .end();
    await coffee
      .fork(x, ['up', '-h'])
      .expect('stdout', /np-x update/)
      .expect('code', 0)
      .end();
    await coffee
      .fork(x, ['fetch', '-h'])
      .expect('stdout', /np-x fetch <pkg>/)
      .expect('code', 0)
      .end();
    await coffee
      .fork(x, ['i', '-h'])
      .expect('stdout', /np-x install, np-x i and np-x add are the same as np/)
      .expect('code', 0)
      .end();
  });

  it('should show version', async () => {
    await coffee
      .fork(x, ['-v'])
      .expect('stdout', /^np v\d+\.\d+\.\d+/)
      .expect('code', 0)
      .end();
  });
});
