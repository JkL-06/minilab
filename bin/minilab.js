#!/usr/bin/env node
'use strict';

/**
 * MiniLab CLI — `minilab` 一键启动持久化 AI 科研实验室服务。
 * 等价于 `node dist/src/server.js`，额外支持 --port / --data-path。
 *
 * 安装方式：
 *   npm install -g minilab    # 全局安装
 *   npx minilab               # 不安装，直接跑
 */

const path = require('node:path');

const args = process.argv.slice(2);

function value(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
function has(name) {
  return args.includes(name);
}

if (has('-v') || has('--version')) {
  console.log(require('../package.json').version);
  process.exit(0);
}

if (has('-h') || has('--help')) {
  console.log(
    [
      'MiniLab — persistent AI research lab',
      '',
      'Usage:',
      '  minilab [options]',
      '',
      'Options:',
      '  --port <n>        listen port  (default: 3000, or $PORT)',
      '  --data-path <p>   SQLite file  (default: ./data/minilab.db, or $DATABASE_PATH)',
      '  -h, --help        show this help',
      '  -v, --version     print version',
      '',
      'After it starts, open http://localhost:3000',
    ].join('\n'),
  );
  process.exit(0);
}

if (has('--port')) process.env.PORT = value('--port', process.env.PORT);
if (has('--data-path')) process.env.DATABASE_PATH = value('--data-path', process.env.DATABASE_PATH);

// 打包成桌面版（pkg）时，启动后自动打开浏览器进 PI 仪表盘。
if (process.pkg) process.env.MINILAB_OPEN_BROWSER = '1';

// server.ts reads process.env.PORT / DATABASE_PATH at import time.
// 注意：必须用字面量相对路径（pkg 静态分析只追踪字面量 require），
// 动态 path.join 会在打包时被漏掉导致 server.js 不进包。
require('../dist/src/server.js');
