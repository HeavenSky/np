#!/usr/bin/env node

// npd-fetch 等同 npd --fetch-only, 参数解析, registry 与缓存配置都沿用 npd
'use strict';

process.argv.splice(2, 0, '--fetch-only');
require('./install');
