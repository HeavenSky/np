// 卸载后清理根 node_modules 中无人使用的提升链接
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

const npmuninstall = path.join(__dirname, '../bin/uninstall.js');

describe('test/uninstall-hoisted-links.test.js', () => {
  const [ tmp, cleanup ] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  async function exists(file) {
    try {
      await fs.lstat(file);
      return true;
    } catch {
      return false;
    }
  }

  async function install(dependencies) {
    await fs.mkdir(tmp, { recursive: true });
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', dependencies }));
    await coffee.fork(helper.npminstall, [], { cwd: tmp }).debug().expect('code', 0).end();
  }

  function uninstall(...names) {
    return coffee.fork(npmuninstall, names, { cwd: tmp }).debug().expect('code', 0).end();
  }

  const rootLink = name => path.join(tmp, 'node_modules', name);

  it('should remove hoisted links of dependencies no one uses, recursively', async () => {
    await install({ agentkeepalive: '4.6.0' });
    assert(await exists(rootLink('humanize-ms')));
    assert(await exists(rootLink('ms')));
    await uninstall('agentkeepalive');
    assert(!(await exists(rootLink('agentkeepalive'))));
    assert(!(await exists(rootLink('humanize-ms'))));
    assert(!(await exists(rootLink('ms'))));
  });

  it('should remove hoisted links of scoped dependencies', async () => {
    await install({ '@types/debug': '4.1.12' });
    assert(await exists(rootLink('@types/ms')));
    await uninstall('@types/debug');
    assert(!(await exists(rootLink('@types/ms'))));
  });

  it('should keep hoisted link when root package.json still declares it', async () => {
    await install({ debug: '4.4.3', ms: '2.1.3' });
    await uninstall('debug');
    assert(await exists(rootLink('ms')));
  });

  it('should keep hoisted link when another package still depends on it', async () => {
    await install({ debug: '4.4.3', 'humanize-ms': '1.2.1' });
    await uninstall('debug');
    assert(await exists(rootLink('humanize-ms')));
    assert(await exists(rootLink('ms')));
  });
});
