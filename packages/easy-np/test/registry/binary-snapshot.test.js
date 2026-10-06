const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const helper = require('../support/helper');
const { useBinarySource } = require('../../lib/download/npm');

describe('test/registry/binary-snapshot.test.js', () => {
  const [dir, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should restore files rewritten by the binary mirror from the snapshot saved in the package dir', async () => {
    const official = { host: 'https://official.example.com' };
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'snapshot-pkg', version: '1.0.0', binary: { host: 'https://mirror.example.com' } })
    );
    await fs.mkdir(path.join(dir, 'lib'));
    await fs.writeFile(path.join(dir, 'lib/install.js'), 'rewritten by mirror');
    await fs.writeFile(
      path.join(dir, '.np-binary-snapshot.json'),
      JSON.stringify({
        pkg: { name: 'snapshot-pkg', version: '1.0.0', binary: official },
        binaryMirror: { host: 'https://mirror.example.com' },
        binary: official,
        files: { 'lib/install.js': Buffer.from('original content').toString('base64') },
      })
    );

    // 进程内没有解压时的快照, 模拟中断后继续或 rebuild
    await useBinarySource(dir, 'official', { mirror: { binaryPackages: new Map() }, console });
    assert.equal(await fs.readFile(path.join(dir, 'lib/install.js'), 'utf8'), 'original content');
    const pkg = await helper.readJSON(path.join(dir, 'package.json'));
    assert.deepEqual(pkg.binary, official);
  });

  it('should do nothing without a snapshot', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-snapshot', version: '1.0.0' }));
    await useBinarySource(dir, 'official', { mirror: { binaryPackages: new Map() }, console });
    const pkg = await helper.readJSON(path.join(dir, 'package.json'));
    assert.equal(pkg.binary, undefined);
  });
});
