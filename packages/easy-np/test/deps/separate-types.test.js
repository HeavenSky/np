const assert = require('node:assert');
const path = require('node:path');
const coffee = require('coffee');
const readJSON = require('../../lib/utils').readJSON;
const helper = require('../support/helper');

describe('test/deps/separate-types.test.js', () => {
  const cwd = helper.fixtures('seperate-dependencies');
  const cleanup = helper.cleanup(cwd);

  async function checkPkg(name, version) {
    const pkgFile = path.join(cwd, 'node_modules', name, 'package.json');
    const pkg = await readJSON(pkgFile);
    assert.equal(pkg.version, version);
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should only install standard dependencies and warn about the others', async () => {
    await coffee
      .fork(helper.npminstall, [], { cwd })
      .debug()
      .expect('code', 0)
      .expect(
        'stderr',
        /clientDependencies, buildDependencies, isomorphicDependencies in package\.json are not installed, pass --include=client,build,isomorphic/
      )
      .end();
    await checkPkg('koa', '1.0.0');
    await checkPkg('mocha', '3.0.0');
    await checkPkg('react', undefined);
    await checkPkg('webpack', undefined);
    await checkPkg('utility', undefined);
  });

  it('should install the listed types with --include', async () => {
    await coffee
      .fork(helper.npminstall, ['--include=client,build', '--include', 'isomorphic'], { cwd })
      .debug()
      .expect('code', 0)
      .notExpect('stderr', /--include/)
      .end();
    await checkPkg('koa', '1.0.0');
    await checkPkg('mocha', '3.0.0');
    await checkPkg('react', '15.0.0');
    await checkPkg('webpack', '3.0.0');
    await checkPkg('utility', '1.0.0');
  });

  it('should install the listed types with --prod', async () => {
    await coffee.fork(helper.npminstall, ['--prod', '--include=isomorphic'], { cwd }).expect('code', 0).end();
    await checkPkg('koa', '1.0.0');
    await checkPkg('mocha', undefined);
    await checkPkg('react', undefined);
    await checkPkg('webpack', undefined);
    await checkPkg('utility', '1.0.0');
  });

  it('should omit and include types like npm', async () => {
    await coffee.fork(helper.npminstall, ['--omit=dev'], { cwd }).expect('code', 0).end();
    await checkPkg('koa', '1.0.0');
    await checkPkg('mocha', undefined);

    await cleanup();
    await coffee.fork(helper.npminstall, ['--production', '--include=dev'], { cwd }).expect('code', 0).end();
    await checkPkg('mocha', '3.0.0');

    await coffee
      .fork(helper.npminstall, ['--omit=foo'], { cwd })
      .expect('code', 1)
      .expect('stderr', /no fooDependencies in package\.json for type "foo"/)
      .end();
  });

  it('should install only the listed fields with --only', async () => {
    await coffee.fork(helper.npminstall, ['--only=client,build,isomorphic'], { cwd }).expect('code', 0).end();
    await checkPkg('koa', undefined);
    await checkPkg('mocha', undefined);
    await checkPkg('react', '15.0.0');
    await checkPkg('webpack', '3.0.0');
    await checkPkg('utility', '1.0.0');

    await cleanup();
    await coffee
      .fork(helper.npminstall, ['--prod', '--exclude=prod', '--include=dev'], { cwd })
      .expect('code', 0)
      .end();
    await checkPkg('koa', undefined);
    await checkPkg('mocha', '3.0.0');
  });

  it('should reject removed and invalid options', async () => {
    await coffee
      .fork(helper.npminstall, ['--client'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--client has been removed, use --only=client,build,isomorphic/)
      .end();
    await coffee
      .fork(helper.npminstall, ['--include=./client'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--include takes dependency types/)
      .end();
    await coffee
      .fork(helper.npminstall, ['--write', 'koa'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--write only accepts the --write=<type> form/)
      .end();
    await coffee
      .fork(helper.npminstall, ['--write=dev'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--write needs package names/)
      .end();
    await coffee
      .fork(helper.npminstall, ['-gD', 'koa'], { cwd })
      .expect('code', 1)
      .expect('stderr', /-D has been removed, use --write=dev/)
      .end();
  });
});
