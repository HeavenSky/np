// 在独立进程里按 argv 中的 JSON 配置调用 installLocal, 供 mirror.test.js 使用真实的 ~/.cnpmrc
'use strict';

const mirror = require('../lib/mirror');
const { installLocal } = require('..');

const { root, pkgs, order, sources, cacheDir } = JSON.parse(process.argv[2]);
const state = mirror.create({ order, binaryOrder: order, sources });
installLocal({ root, pkgs, registry: state.registry, cacheDir, mirror: state }).catch(err => {
  console.error(err);
  process.exit(1);
});
