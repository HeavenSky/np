const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');
const allowScripts = require('../lib/allow_scripts');

const x = path.join(__dirname, '..', 'bin', 'x.js');

describe('test/allow-scripts.test.js', () => {
  describe('check()', () => {
    const id = (name, version) => ({ name, version });

    it('should match names, pinned versions and exact version lists', () => {
      const policy = { a: true, 'b@1.0.0 || 1.0.2': true, 'c@*': true };
      assert.equal(allowScripts.check(policy, id('a', '9.9.9')), true);
      assert.equal(allowScripts.check(policy, id('b', '1.0.2')), true);
      assert.equal(allowScripts.check(policy, id('b', '1.0.1')), null);
      assert.equal(allowScripts.check(policy, id('c', '1.0.0')), true);
      assert.equal(allowScripts.check(policy, id('d', '1.0.0')), null);
    });

    it('should let false win over true', () => {
      const policy = { d: true, 'd@2.0.0': false };
      assert.equal(allowScripts.check(policy, id('d', '2.0.0')), false);
      assert.equal(allowScripts.check(policy, id('d', '1.0.0')), true);
    });

    it('should match git dependencies by repository and optional commit', () => {
      const git = { git: 'git+ssh://git@github.com/x/y.git#abc' };
      assert.equal(allowScripts.check({ 'github:x/y': true }, git), true);
      assert.equal(allowScripts.check({ 'git+https://github.com/x/y.git#abc': true }, git), true);
      assert.equal(allowScripts.check({ 'github:x/y#def': true }, git), null);
      assert.equal(allowScripts.check({ y: true }, git), null);
    });

    it('should ignore ranges and dist-tags with a warning', () => {
      const warnings = [];
      const state = allowScripts.load({
        argv: { 'allow-scripts': 'a@^1.0.0,b@latest,c' },
        logger: { warn: (...args) => warnings.push(args.join(' ')) },
      });
      assert.deepEqual(state.policy, { c: true });
      assert.equal(warnings.length, 2);
    });
  });

  describe('install', () => {
    const [root, cleanup] = helper.tmp();
    const writePkg = extra =>
      fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'postinstall-hello': '1.0.0' }, ...extra })
      );
    const run = (bin, args) => coffee.fork(bin, args, { cwd: root });

    beforeEach(cleanup);
    afterEach(cleanup);

    it('should skip unreviewed dependency scripts, approve them and rebuild', async () => {
      await writePkg();
      await run(helper.npminstall, ['--foreground-scripts'])
        .expect('code', 0)
        .notExpect('stdout', /run on postinstall-hello/)
        .expect('stderr', /1 package\(s\) have install scripts that are not in allowScripts and were skipped/)
        .expect('stderr', /postinstall-hello@1.0.0 \(postinstall\)/)
        .expect('stderr', /npd-x approve-scripts postinstall-hello && npd-x rebuild postinstall-hello/)
        .end();

      await run(x, ['approve-scripts', '--pending']).expect('stdout', /postinstall-hello@1.0.0 \(postinstall\)/).end();
      await run(x, ['approve-scripts', 'postinstall-hello']).expect('code', 0).end();
      const pkg = await helper.readJSON(path.join(root, 'package.json'));
      assert.deepEqual(pkg.allowScripts, { 'postinstall-hello@1.0.0': true });

      await run(x, ['rebuild', 'postinstall-hello'])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
    });

    it('should fail with --strict-allow-scripts and stay quiet for denied packages', async () => {
      await writePkg();
      await run(helper.npminstall, ['--strict-allow-scripts'])
        .expect('code', 1)
        .expect('stderr', /were blocked/)
        .end();

      await cleanup();
      await writePkg({ allowScripts: { 'postinstall-hello': false } });
      await run(helper.npminstall, ['--strict-allow-scripts', '--foreground-scripts'])
        .expect('code', 0)
        .notExpect('stderr', /allowScripts/)
        .notExpect('stdout', /run on postinstall-hello/)
        .end();
    });

    it('should run every script with --dangerously-allow-all-scripts', async () => {
      await writePkg();
      await run(helper.npminstall, ['--dangerously-allow-all-scripts', '--foreground-scripts'])
        .expect('code', 0)
        .expect('stdout', /run on postinstall-hello/)
        .end();
    });
  });
});
