#!/usr/bin/env node

// np-fetch 等同 np --fetch-only, 参数解析, registry 与缓存配置都沿用 np

process.argv.splice(2, 0, '--fetch-only');
require('./install');
