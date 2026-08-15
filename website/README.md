# MiniLab 下载网站（website/）

MiniLab 的官方下载与安装落地页（`index.html`）——零依赖的纯静态单页，中文，
任何人拿到 `index.html` 都可以直接打开或托管到任意静态平台。

- **线上地址**：https://JkL-06.github.io/minilab/ （GitHub Pages，源 = `gh-pages` 分支）
- **代码仓库**：https://github.com/JkL-06/minilab

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
};
```

所有「立即下载」「下载 ZIP」按钮与命令行 `git clone` 示例都由 `CONFIG` 驱动。
改版本号时同步更新 `version` 与文案里的版本、SPEC 编号、测试数。

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
git push origin HEAD:refs/heads/gh-pages
cd ..
```

推完后 GitHub Pages 会在约 1 分钟内重新构建，线上地址不变。

## 本地预览

```bash
cd website
npx serve .        # → http://localhost:5000
# 或直接双击打开 index.html（静态单页，无跨域依赖）
```

## 其他发布渠道（可选）

- **Cloudflare Pages / Netlify**：拖拽上传整个 `website/` 目录即得 HTTPS 域名，与 GitHub Pages 可并存。
- **npm 分发（未来）**：v0.1 以源码分发；后续可发布 `npx minilab` CLI 包，把体验做到和主流 CLI 工具一致。

## 注意

- 开发包 `MiniLab-Development-Pack-v0.1/`、`data/`、`node_modules/`、`dist/`、`.claude/`、
  `*.key` 都在仓库 `.gitignore` 中，**不会**随公开仓库发布。
- 网站文案里的测试数（353）、SPEC 编号、端口（3000）请随仓库实际状态更新。
