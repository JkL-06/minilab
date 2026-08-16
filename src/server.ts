import { exec } from 'node:child_process';

import { createMiniLabApp } from './createMiniLabApp';

/**
 * CLI 入口（npm start / node dist/src/server.js）：装配 → 监听 → （桌面版）开浏览器。
 * 装配逻辑见 createMiniLabApp —— Electron 主进程（electron/main.ts）复用同一装配，
 * 只是改由自己的窗口加载 URL。
 */
const { app, port, host, databasePath } = createMiniLabApp();

app.listen(port, host, () => {
  console.log(`MiniLab API listening on http://${host}:${port}`);
  console.log(`Database: ${databasePath}`);
  // 打包成桌面版（pkg）时自动打开默认浏览器进 PI 仪表盘
  if (process.env.MINILAB_OPEN_BROWSER === '1') {
    const url = `http://localhost:${port}`;
    const cmd =
      process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
