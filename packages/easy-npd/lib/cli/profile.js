// 命令入口: npd 等同 npd-x install 再加上 --no-lockfile 与 --dangerously-allow-all-scripts, 其余逻辑完全相同
'use strict';

// 经环境变量传给安装脚本: 依赖脚本用 npm_execpath(bin/i.js)嵌套安装时必须沿用 npd-x, 否则会放行全部依赖脚本
const ENTRY_ENV = '_NPD_CLI_ENTRY_';

// npd 在命令行没有给出时补上的参数, 视同命令行参数, 高于环境变量与配置文件, 只能由命令行覆盖
const NPD_DEFAULT_ARGS = { lockfile: false, 'dangerously-allow-all-scripts': true };

exports.use = name => {
  process.env[ENTRY_ENV] = name;
};

exports.defaultArgs = () => (process.env[ENTRY_ENV] === 'npd-x' ? {} : NPD_DEFAULT_ARGS);
