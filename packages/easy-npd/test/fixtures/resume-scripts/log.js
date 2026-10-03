// 记录执行过的脚本; RESUME_FLAG 指向的文件不存在时 postinstall 失败
const fs = require('node:fs');

const script = process.argv[2];
fs.appendFileSync(process.env.RESUME_LOG, `${script}\n`);
if (script === 'postinstall' && !fs.existsSync(process.env.RESUME_FLAG)) process.exit(1);
