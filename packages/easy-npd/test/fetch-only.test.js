// npd-fetch 只下载解压指定的包, 不装依赖, 不跑脚本, 不改 package.json
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

const npdfetch = path.join(__dirname, '../bin/fetch.js');

describe('test/fetch-only.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
  });
  afterEach(cleanup);

  async function exists(file) {
    try {
      await fs.lstat(file);
      return true;
    } catch {
      return false;
    }
  }

  function fetch(...args) {
    return coffee.fork(npdfetch, args, { cwd: tmp }).debug();
  }

  it('should only extract the listed packages without dependencies or package.json changes', async () => {
    await fetch('debug@4.4.3').expect('code', 0).end();
    const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'node_modules/debug/package.json')));
    assert.equal(pkg.version, '4.4.3');
    assert(!(await exists(path.join(tmp, 'node_modules/ms'))));
    assert(!(await exists(path.join(tmp, 'node_modules/_debug@4.4.3@debug/node_modules'))));
    const rootPkg = JSON.parse(await fs.readFile(path.join(tmp, 'package.json')));
    assert.equal(rootPkg.dependencies, undefined);
  });

  it('should not run lifecycle scripts or link bins', async () => {
    const local = path.join(tmp, 'local-pkg');
    await fs.mkdir(local);
    await fs.writeFile(
      path.join(local, 'package.json'),
      JSON.stringify({
        name: 'local-pkg',
        version: '1.0.0',
        bin: { 'local-pkg': 'index.js' },
        dependencies: { ms: '2.1.3' },
        scripts: Object.fromEntries(
          ['preinstall', 'install', 'postinstall'].map(name => [
            name,
            `node -e "require('fs').writeFileSync('${path.join(tmp, name)}', '')"`,
          ])
        ),
      })
    );
    await fs.writeFile(path.join(local, 'index.js'), '');
    await fetch('./local-pkg').expect('code', 0).end();
    assert(await exists(path.join(tmp, 'node_modules/local-pkg/package.json')));
    assert(!(await exists(path.join(tmp, 'node_modules/ms'))));
    assert(!(await exists(path.join(tmp, 'node_modules/.bin/local-pkg'))));
    for (const name of ['preinstall', 'install', 'postinstall']) {
      assert(!(await exists(path.join(tmp, name))), `${name} script should not run`);
    }
  });

  it('should install dependencies on the next full install', async () => {
    await fetch('debug@4.4.3').expect('code', 0).end();
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { debug: '4.4.3' } })
    );
    await coffee.fork(helper.npminstall, [], { cwd: tmp }).debug().expect('code', 0).end();
    assert(await exists(path.join(tmp, 'node_modules/_debug@4.4.3@debug/node_modules/ms')));
  });

  it('should reject git packages', async () => {
    await fetch('github:debug-js/debug')
      .expect('code', 1)
      .expect('stderr', /npd-fetch does not support git package/)
      .end();
  });

  it('should fail without packages', async () => {
    await fetch()
      .expect('code', 1)
      .expect('stderr', /npd-fetch needs at least one package/)
      .end();
  });
});
