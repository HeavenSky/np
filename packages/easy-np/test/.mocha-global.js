// mocha 全局 fixture: 全部用例结束后在主进程清理 helper.tmp() 生成的临时目录
'use strict';

const fs = require('fs/promises');
const { mkdirSync } = require('fs');
const path = require('path');

const fixtures = path.join(__dirname, 'fixtures');

// 开发者 shell 或 npm run / npx 注入的这些变量会改变被测 CLI 的缓存目录, 源, 生产模式与 npm 配置,
// 例如 np_cache 与 npm_config_cache 会让缓存类用例写到用例目录之外; 在主进程与各 worker 加载时清掉, 需要的用例显式传入
const INHERITED_ENV = /^(?:np_cache|npm_config_.+|npm_registry|npm_rootpath|INIT_CWD|NODE_ENV|NPD?_BY_UPDATE)$/i;
for (const key of Object.keys(process.env)) {
  if (INHERITED_ENV.test(key)) delete process.env[key];
}

// 用固定的测试 HOME 隔离开发者的 ~/.npmrc(其中的 token 会随请求发出), ~/.nprc 与 ~/.gitconfig;
// 目录不以 .tmp_ 开头, 跨次保留, 其中的磁盘缓存 ~/.np_tarball 不必每次重新下载
const testHome = path.join(fixtures, '.home');
mkdirSync(testHome, { recursive: true });
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

exports.mochaGlobalTeardown = async () => {
  const names = await fs.readdir(fixtures);
  await Promise.all(
    names
      .filter(name => name.startsWith('.tmp_'))
      .map(name => fs.rm(path.join(fixtures, name), { recursive: true, force: true }))
  );
};
