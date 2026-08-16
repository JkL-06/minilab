import { app, BrowserWindow, Tray, Menu, dialog, nativeImage, session } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';

import { createMiniLabApp } from '../src/createMiniLabApp';

/**
 * MiniLab 桌面版（Electron）主进程。
 *
 * 架构：Electron 只是「壳」——主进程内嵌启动现有 Express 服务器（随机端口，
 * 避免与任何已占用端口冲突），再用 BrowserWindow 加载本地 URL。后端
 * （Express + better-sqlite3 + 真实 LLM）零改动全复用，窗口里渲染的就是已有的
 * PI 仪表盘。身份是 cookie 会话（多用户）：首次启动 users 表为空 → /setup 引导
 * 创建 0 号用户；之后每次启动都需要重新登录（进程内 session，退出即失效）。
 *
 * 行为：关闭窗口 → 隐藏到系统托盘常驻（服务继续跑）；托盘右键「显示主窗口 / 退出」。
 */

// better-sqlite3 原生绑定：打包后 node_modules 在 app.asar 内，`bindings` 包的 fs
// 探测对 asar 路径不可靠。直接 require 出 asarUnpack 的真实 .node，设进全局变量，
// DB 层（openDatabase）通过官方 nativeBinding 选项接收——与 pkg 版 bin/minilab.js
// 的 shim 同机制。开发模式（electron .）不加，走 node_modules 默认加载。
if (app.isPackaged) {
  const addonPath = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  );
  try {
    (globalThis as { __minilabSqliteAddon?: unknown }).__minilabSqliteAddon = require(addonPath);
  } catch (e) {
    console.error('[MiniLab] 加载 SQLite 原生模块失败（将回退到默认探测）:', e);
  }
}

// 桌面版标记：未登录的浏览器导航 302 到登录页（users 空则 /setup），API 请求
// 继续按 JSON 契约返回 401。见 src/api/auth.ts 的 sessionAuth/requireUser。
process.env.MINILAB_DESKTOP = '1';

// 数据路径：优先环境变量 → 复用既有 E 盘库（用户已有的博士规划数据）→ 用户数据目录。
function resolveDatabasePath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const legacy = 'E:\\MiniLab\\data\\minilab.db';
  if (existsSync(legacy)) return legacy;
  return path.join(app.getPath('userData'), 'minilab.db');
}
process.env.DATABASE_PATH = resolveDatabasePath();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function showMainWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// 单实例：防止双击/重复启动产生多个进程同时写同一 SQLite。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  void app.whenReady().then(() => {
    // 麦克风权限：仪表盘 🎤 录音需要 getUserMedia。本应用只加载本地 127.0.0.1
    // 页面（无远程内容），放行媒体请求是安全的；拒绝其它任何权限。
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
    session.defaultSession.setDevicePermissionHandler((_details) => true);

    const { app: expressApp } = createMiniLabApp({ port: 0 });

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      title: 'MiniLab',
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    mainWindow.on('close', (event) => {
      // 关闭窗口 = 隐藏到托盘常驻；真正退出走托盘菜单或系统退出。
      if (!quitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });

    // 默认随机端口（避开已占用端口）；可显式设 PORT 固定（便于调试/脚本探测）。
    const listenPort = Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 0;
    const server: Server = expressApp.listen(listenPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : listenPort;
      console.log(`[MiniLab] API listening on http://127.0.0.1:${port}`);
      console.log(`[MiniLab] Database: ${process.env.DATABASE_PATH}`);
      void mainWindow?.loadURL(`http://127.0.0.1:${port}/`);
    });
    server.on('error', (err) => {
      dialog.showErrorBox('MiniLab 启动失败', `本地服务启动失败：\n${String(err)}`);
      app.quit();
    });

    // 系统托盘常驻。
    tray = new Tray(
      nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.ico')),
    );
    tray.setToolTip('MiniLab — 本地持久化 AI 科研实验室');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: showMainWindow },
        { type: 'separator' },
        { label: '退出', click: () => { quitting = true; app.quit(); } },
      ]),
    );
  });

  // 所有窗口关闭时不退出——托盘常驻。真正退出走托盘「退出」。
  app.on('window-all-closed', () => {
    // 故意不调用 app.quit()。
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('activate', showMainWindow);
}
