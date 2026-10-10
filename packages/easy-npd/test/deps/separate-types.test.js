'use strict';

const assert = require('assert');
const path = require('path');
const coffee = require('coffee');
const readJSON = require('../../lib/utils').readJSON;
const helper = require('../support/helper');

describe('test/deps/separate-types.test.js', () => {
  const cwd = helper.fixtures('seperate-dependencies');
  const cleanup = helper.cleanup(cwd);

  async function checkPkg(name, version) {
    const pkg = await readJSON(path.join(cwd, 'node_modules', name, 'package.json'));
    assert(pkg.version === version);
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

  it('should only install the listed types with --only and --prod', async () => {
    await coffee.fork(helper.npminstall, ['--only=client,build'], { cwd }).expect('code', 0).end();
    await checkPkg('koa', undefined);
    await checkPkg('mocha', undefined);
    await checkPkg('react', '15.0.0');
    await checkPkg('webpack', '3.0.0');
    await checkPkg('utility', undefined);

    await cleanup();
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
    await coffee.fork(helper.npminstall, ['--exclude=dev'], { cwd }).expect('code', 0).end();
    await checkPkg('mocha', undefined);

    await cleanup();
    await coffee.fork(helper.npminstall, ['--production', '--include=dev'], { cwd }).expect('code', 0).end();
    await checkPkg('mocha', '3.0.0');

    await coffee
      .fork(helper.npminstall, ['--omit=nothere'], { cwd })
      .expect('code', 1)
      .expect('stderr', /no nothereDependencies in package\.json for type "nothere"/)
      .end();
  });

  it('should reject removed and invalid options', async () => {
    await coffee
      .fork(helper.npminstall, ['--client'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--client has been removed, use --only=client,build,isomorphic/)
      .end();
    for (const [args, message] of [
      [['-D', 'koa'], /-D has been removed, use --write=dev/],
      [['--save-exact', 'koa'], /--save-exact has been removed, use --write-exact/],
      [['--lockfile-path=x'], /--lockfile-path has been removed, use --from-package-lock/],
      [['--root=x'], /--root has been removed/],
      [['-d'], /-d has been removed, use --detail/],
    ]) {
      await coffee.fork(helper.npminstall, args, { cwd }).expect('code', 1).expect('stderr', message).end();
    }
    await coffee
      .fork(helper.npminstall, ['--include=./client'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--include takes dependency types/)
      .end();
    await coffee
      .fork(helper.npminstall, ['koa', '--write', 'dev'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--write only accepts the --write=<type> form/)
      .end();
    await coffee
      .fork(helper.npminstall, ['--write=dev'], { cwd })
      .expect('code', 1)
      .expect('stderr', /--write needs package names/)
      .end();
  });
});
