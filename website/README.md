# MiniLab 下载网站（website/）

MiniLab 的官方下载与安装落地页（`index.html`）——零依赖的纯静态单页，中文，
任何人拿到 `index.html` 都可以直接打开或托管到任意静态平台。

- **线上地址**：https://JkL-06.github.io/minilab/ （GitHub Pages，源 = `gh-pages` 分支）
- **代码仓库**：https://github.com/JkL-06/minilab
- **npm 包**：https://www.npmjs.com/package/minilab （`npx minilab` 一行安装）
- **Windows 桌面版**：https://github.com/JkL-06/minilab/releases/download/v0.1.0/MiniLab.exe
  （GitHub Release `v0.1.0`，单文件免装 Node.js，双击即用）

## 目录

| 文件 | 说明 |
|---|---|
| `index.html` | 网站本体（自包含：内联 CSS / JS，无外链字体与 CDN） |
| `preview.html` | 供 claude.ai Artifact 预览用的副本（由 `rebuild-preview.sh` 从 `index.html` 同步生成，已 gitignore） |
| `README.md` | 本文件 |
| `rebuild-preview.sh` | 改完 `index.html` 后一键重建 `preview.html` |

## 网站配置（`index.html` 顶部 `CONFIG`）

```js
const CONFIG = {
  version: 'v0.1',
  repoUrl: 'https://github.com/JkL-06/minilab',                          // 代码仓库
  zipUrl: 'https://github.com/JkL-06/minilab/archive/refs/heads/main.zip', // 直接下载 ZIP
  npmUrl: 'https://www.npmjs.com/package/minilab',                       // npm 页面（npx minilab）
  exeUrl: 'https://github.com/JkL-06/minilab/releases/download/v0.1.0/MiniLab.exe', // 桌面版 exe
};
```

所有「立即下载」「下载 ZIP」按钮与命令行示例（`npx minilab` / `git clone`）都由
`CONFIG` 驱动。改版本号时同步更新 `version` 与文案里的版本、SPEC 编号、测试数。

## 改完网站怎么上线（GitHub Pages，源为 `gh-pages` 分支）

`gh-pages` 分支里只有网站文件（`index.html` / `README.md` / `rebuild-preview.sh`）。

⚠️ 不要在工作区里 `git checkout --orphan gh-pages` + `git rm -rf .`：那会连
`.gitignore` 一起删掉，紧接着的 `git add -A` 会把 `node_modules/`、`data/`、
开发包等一并提交进分支（已踩过这个坑）。正确做法——在**独立的临时目录**里重建：

```bash
# 1) 正常提交网站改动到 main 并推送
git add website/index.html website/README.md
git commit -m "site: ..."
git push origin main

# 2) 在隔离的临时目录重建 gh-pages（只含网站文件）并推送
rm -rf /tmp/ghpages && mkdir -p /tmp/ghpages
cp website/index.html website/README.md website/rebuild-preview.sh /tmp/ghpages/
cd /tmp/ghpages && git init -q && git add -A
git -c user.name="JkL-06" -c user.email="ljkcka666@163.com" commit -q -m "site: update"
git remote add origin https://github.com/JkL-06/minilab.git
# 临时目录是全新历史，每次都是非快进，必须 --force
git push --force origin HEAD:refs/heads/gh-pages
cd ..
```

推完后 GitHub Pages 会在约 1 分钟内重新构建，线上地址不变。

## 本地预览

```bash
cd website
npx serve .        # → http://localhost:5000
# 或直接双击打开 index.html（静态单页，无跨域依赖）
```

## 其他发布渠道

- **Windows 桌面版 (exe)**：用 `@yao-pkg/pkg@6.0.0` 把 Node 20 运行时 + 服务器 + better-sqlite3
  原生模块打成单个 `MiniLab.exe`（约 59 MB），上传为 GitHub Release 资产。命令 `npm run build:exe`。
  关键点：
  - ⚠️ 构建必须 `pkg .`（**目录入口**）而不能 `pkg bin/minilab.js`——`package.json` 里的
    `pkg.assets` 只在入口是 package.json/目录时才被读取，JS 入口会静默丢掉资产（已踩坑）。
  - `bin/minilab.js` 的 require 必须用**字面量路径**（pkg 静态分析只追踪字面量）。
  - better-sqlite3 的 `.node` 绑定经 `pkg.assets` 打入（存在 blob 存储，`fs` 看不见但
    `require()` 能加载）。打包版里 `bin/minilab.js` 用 `require(资产路径)` 取出 addon 对象放进
    `globalThis.__minilabSqliteAddon`，DB 层通过 better-sqlite3 官方 `nativeBinding` 选项接收——
    彻底绕开 `bindings` 包的 fs 探测（否则必报 "Could not locate the bindings file"）。
  - 打包版启动后 `MINILAB_OPEN_BROWSER=1` 自动开浏览器。
  - 首次下载的 exe 会被 SmartScreen 拦下（未签名）：网站 exe 标签已注明「属性 → 解除锁定」或
    「更多信息 → 仍要运行」。
  - 发新版：`npm run build:exe` → 建 Release 标签 → 上传资产（同名替换：先删旧资产再传）
    → 更新本文件与 `index.html` 的 `CONFIG.exeUrl` 与尺寸文案。
- **Cloudflare Pages / Netlify**：拖拽上传整个 `website/` 目录即得 HTTPS 域名，与 GitHub Pages 可并存。
- **npm 分发（已上线）**：`minilab@0.1.0` 已发布到 npm，任何机器装好 Node.js 20+ 后运行
  `npx minilab` 即可启动。发布流程：`npm publish`（`prepublishOnly` 会自动先构建 + 跑 353 项测试）。
  ⚠️ 发布前 npm 账号需开启 2FA，并生成 **Granular Access Token**：Package access = **All packages**、
  Permissions = **Read and write**、勾选 **Bypass 2FA**——否则 `npm publish` 返回 403。

## 注意

- 开发包 `MiniLab-Development-Pack-v0.1/`、`data/`、`node_modules/`、`dist/`、`.claude/`、
  `*.key` 都在仓库 `.gitignore` 中，**不会**随公开仓库发布。
- 网站文案里的测试数（353）、SPEC 编号、端口（3000）请随仓库实际状态更新。
