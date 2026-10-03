// npd 与 npd-x 的命令表与分派: 子命令及其别名映射到同目录下的入口模块, 参数原样转交
'use strict';

const help = require('./help');

// fetch 与 rebuild 是 install 的两种模式, 由 install 按参数选择帮助与流程
const COMMANDS = [
  { name: 'install', aliases: ['i', 'add'], run: args => require('./install')(args) },
  { name: 'uninstall', aliases: ['un', 'remove', 'rm', 'r'], run: args => require('./uninstall')(args) },
  { name: 'update', aliases: ['up', 'upgrade'], run: args => require('./update')(args) },
  { name: 'link', aliases: ['ln'], run: args => require('./link')(args) },
  { name: 'fetch', aliases: [], run: args => require('./install')(['--fetch-only', ...args]) },
  { name: 'rebuild', aliases: ['rb'], run: args => require('./install')(['--rebuild', ...args]) },
];

function findCommand(name) {
  return COMMANDS.find(cmd => cmd.name === name || cmd.aliases.includes(name));
}

// npd: 直接执行指定子命令
exports.run = (name, args) => findCommand(name).run(args);

// npd-x <command> [args]
exports.main = args => {
  const [first, ...rest] = args;
  if (first === '-v' || first === '--version') {
    console.log(`npd v${require('../../package.json').version}`);
    return;
  }
  if (first === '-h' || first === '--help') {
    console.log(help.commands(COMMANDS));
    return;
  }
  const name = first === 'help' ? rest[0] : first;
  const cmd = name && findCommand(name);
  if (!cmd) {
    if (name) console.error(`npd-x: unknown command "${name}"`);
    console.log(help.commands(COMMANDS));
    // npd-x help 不带命令时只是查看帮助, 其余情况都是用法错误
    if (first !== 'help' || name) process.exitCode = 1;
    return;
  }
  return cmd.run(first === 'help' ? ['--help'] : rest);
};
