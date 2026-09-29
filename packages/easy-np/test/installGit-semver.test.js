// git 依赖的包名不一致告警与 semver: ref, Windows 上跳过
const assert = require('node:assert');
const path = require('node:path');
const coffee = require('coffee');
const fs = require('node:fs');
const helper = require('./helper');

describe('test/installGit-semver.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  beforeEach(cleanup);
  afterEach(cleanup);

  // skip windows
  if (process.platform !== 'win32') {
    it('should warn on some name not match', done => {
      coffee
        .fork(helper.npminstall, ['error@git+https://github.com/mozilla/nunjucks.git#0f8b21b8d'], {
          cwd: tmp,
        })
        .debug()
        .expect('code', 0)
        .expect('stderr', /Package name unmatched: expected error but found nunjucks/)
        .end(err => {
          assert(require(path.join(tmp, 'node_modules/error/package.json')).name === 'nunjucks');
          done(err);
        });
    });

    it('should install success', done => {
      coffee
        .fork(helper.npminstall, ['a@git+ssh://git@bitbucket.org/saibotsivad/demo-npm-git-semver.git#semver:1.0.3'], {
          cwd: tmp,
        })
        .debug()
        .expect('code', 0)
        .end(() => {
          const nodeModulesDir = path.join(tmp, 'node_modules');
          // check package installed and linked
          const symlink = fs.readlinkSync(path.join(nodeModulesDir, 'a'));
          assert.strictEqual(require(path.join(nodeModulesDir, 'a/package.json')).name, 'demo-npm-git-semver');
          // check package real package existed
          assert.strictEqual(require(path.join(nodeModulesDir, `${symlink}/package.json`)).name, 'demo-npm-git-semver');
          done();
        });
    });

    it('should install with https success', done => {
      coffee
        .fork(helper.npminstall, ['a@git+https://git@bitbucket.org/saibotsivad/demo-npm-git-semver.git#semver:1.0.3'], {
          cwd: tmp,
        })
        .debug()
        .expect('code', 0)
        .end(() => {
          const nodeModulesDir = path.join(tmp, 'node_modules');
          // check package installed and linked
          const symlink = fs.readlinkSync(path.join(nodeModulesDir, 'a'));
          assert.strictEqual(require(path.join(nodeModulesDir, 'a/package.json')).name, 'demo-npm-git-semver');
          // check package real package existed
          assert.strictEqual(require(path.join(nodeModulesDir, `${symlink}/package.json`)).name, 'demo-npm-git-semver');
          done();
        });
    });
  }
});
