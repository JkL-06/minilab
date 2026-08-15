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
      '  --host <addr>     listen address (default: 127.0.0.1, or $HOST)',
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
if (has('--host')) process.env.HOST = value('--host', process.env.HOST);
if (has('--data-path')) process.env.DATABASE_PATH = value('--data-path', process.env.DATABASE_PATH);

// 打包成桌面版（pkg）时，启动后自动打开浏览器进 PI 仪表盘。
if (process.pkg) process.env.MINILAB_OPEN_BROWSER = '1';

// 启动器模式标记（npx/minilab 与打包版 exe 都走本文件）：src/api/auth.ts 的
// desktopBrowserFallback 据此对「纯浏览器访问（Accept 含 text/html、无
// x-user-id 头）」放行，认作本地单机用户 local-pi，让「打开网页即是 PI 仪表盘」
// 在产品启动方式下成立。直接 `node dist/src/server.js`（源码/开发）不设置，
// SPEC-001 的 x-user-id 契约保持不变；curl/API 客户端也不会被误判。
process.env.MINILAB_DESKTOP = '1';

// 打包版：better-sqlite3 的原生绑定（.node）作为资产嵌在包内，但 pkg 的资产
// 只对 require() 可见、对 fs.existsSync 不可见——better-sqlite3 依赖的 `bindings`
// 包用 fs 逐路径探测，在快照里必然失败（“Could not locate the bindings file”）。
// 这里直接用 require() 加载嵌入的 addon 对象，存进全局变量交给 DB 层，
// DB 层通过 better-sqlite3 官方 nativeBinding 选项接收，彻底绕开 bindings。
if (process.pkg) {
  const addonCandidates = [
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'build', 'better_sqlite3.node'),
  ];
  for (const candidate of addonCandidates) {
    try {
      globalThis.__minilabSqliteAddon = require(candidate);
      break;
    } catch (e) {
      // MODULE_NOT_FOUND = 该候选路径没有资产，换下一个；
      // 其它错误（如 dlopen 失败）是真实失败，停止尝试。
      if (!e || (e.code !== 'MODULE_NOT_FOUND' && !/not find/i.test(String(e.message)))) {
        break;
      }
    }
  }
}

// server.ts reads process.env.PORT / DATABASE_PATH at import time.
// 注意：必须用字面量相对路径（pkg 静态分析只追踪字面量 require），
// 动态 path.join 会在打包时被漏掉导致 server.js 不进包。
require('../dist/src/server.js');
