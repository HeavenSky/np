// np 与 np-x 的命令表与分派: 子命令及其别名映射到同目录下的入口模块, 参数原样转交
const help = require('./help');
const profile = require('./profile');

// fetch 与 rebuild 是 install 的两种模式, 由 install 按参数选择帮助与流程
const COMMANDS = [
  { name: 'install', aliases: ['i', 'add'], run: args => require('./install')(args) },
  { name: 'uninstall', aliases: ['remove', 'rm'], run: args => require('./uninstall')(args) },
  { name: 'update', aliases: ['up', 'upgrade'], run: args => require('./update')(args) },
  { name: 'link', aliases: ['ln'], run: args => require('./link')(args) },
  { name: 'fetch', aliases: [], run: args => require('./install')(args, { mode: 'fetch' }) },
  { name: 'rebuild', aliases: [], run: args => require('./install')(args, { mode: 'rebuild' }) },
  { name: 'approve-scripts', aliases: ['approve'], run: args => require('./approve_scripts')(args) },
  { name: 'deny-scripts', aliases: ['deny'], run: args => require('./approve_scripts').deny(args) },
  { name: 'prune', aliases: [], run: args => require('./prune')(args) },
];

function findCommand(name) {
  return COMMANDS.find(cmd => cmd.name === name || cmd.aliases.includes(name));
}

// np: 直接执行指定子命令; 预设默认 npminstall, 在 np-x 的安装脚本中嵌套执行时沿用 np-x 的预设
exports.run = (name, args) => findCommand(name).run(args);

// np-x <command> [args]
exports.main = args => {
  profile.use('np-x');
  const [first, ...rest] = args;
  if (first === '-v' || first === '--version') {
    console.log(`np v${require('../../package.json').version}`);
    return;
  }
  if (first === '-h' || first === '--help') {
    console.log(help.commands(COMMANDS));
    return;
  }
  const name = first === 'help' ? rest[0] : first;
  const cmd = name && findCommand(name);
  if (!cmd) {
    if (name) console.error(`np-x: unknown command "${name}"`);
    console.log(help.commands(COMMANDS));
    // np-x help 不带命令时只是查看帮助, 其余情况都是用法错误
    if (first !== 'help' || name) process.exitCode = 1;
    return;
  }
  return cmd.run(first === 'help' ? ['--help'] : rest);
};
