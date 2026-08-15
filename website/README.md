# MiniLab 下载网站（website/）

MiniLab 的官方下载与安装落地页（`index.html`）——零依赖的纯静态单页，中文，
任何人拿到 `index.html` 都可以直接打开或托管到任意静态平台。

## 目录

| 文件 | 说明 |
|---|---|
| `index.html` | 网站本体（自包含：内联 CSS / JS，无外链字体与 CDN） |
| `preview.html` | 供 claude.ai Artifact 预览用的副本（内容与 `index.html` 同步生成） |
| `README.md` | 本文件 |

> `preview.html` 由 `index.html` 生成，改完 `index.html` 后重新执行：
> `sed -n '/<style>/,/<\/style>/p' index.html > preview.html; echo '<title>MiniLab · 下载与安装</title>' > tmp && cat preview.html >> tmp && { sed -n '/<body>/,/<\/body>/p' index.html | grep -v '^<body>$' | grep -v '^</body>$' } >> tmp && mv tmp preview.html`
> （或在 bash 里跑 `./website/rebuild-preview.sh` 若存在。）

## 发布前必须做的两件事

1. **把源码托管到公开仓库**，得到仓库地址，例如 `https://github.com/you/minilab`。
2. **编辑 `index.html` 顶部 `CONFIG`**：

   ```js
   const CONFIG = {
     version: 'v0.1',
     repoUrl: 'https://github.com/你的用户名/minilab',  // ← 改成你的仓库地址
     zipUrl: '',                                        // ← 可选：直链 ZIP 下载地址
   };
   ```

   填完后，「立即下载」「下载 ZIP」按钮、命令行 `git clone` 示例都会自动指向你的仓库。
   `zipUrl` 留空时，所有下载按钮跳到仓库页（可点击页面右上角「Code → Download ZIP」下载源码包）。

## 免费托管这个网站

### 方案 A：GitHub Pages（推荐，和代码仓库放一起）

1. 在 GitHub 新建一个公开仓库 `minilab`，把 `E:\MiniLab` 的代码推上去。
2. 仓库 Settings → Pages → Source 选 `main` 分支 / `/`（根目录）。
3. 这样代码仓库 + 网站共用同一份文件：别人克隆代码，也能打开 `index.html` 浏览官网。

### 方案 B：Cloudflare Pages / Netlify / Vercel（无需代码仓库）

1. 打开对应平台 → 新建项目 →「拖拽上传 / Direct Upload」。
2. 把整个 `website/` 目录拖进去，部署即完成，自动获得 HTTPS 域名。
3. 以后每次改完 `index.html` 重新上传即可。

### 本地预览

```bash
cd website
npx serve .        # → http://localhost:5000
# 或直接双击打开 index.html（静态单页，无跨域依赖）
```

## 把「下载」真正打通

网站本身只是个入口，别人能下载的前提是源码已经可获取。任选其一：

- **GitHub 公开仓库**（最标准）：`git init && git add -A && git commit -m "MiniLab v0.1"`，
  然后 `gh repo create minilab --public --source . --push`（装好 GitHub CLI）或网页端新建仓库后 `git remote add origin … && git push -u origin main`。
- **发布 Release ZIP**：GitHub 仓库 → Releases → 新建 release，附上源码 zip；
  把该 zip 的直链填进 `CONFIG.zipUrl`，下载按钮就直接给包。
- **npm 分发（未来）**：v0.1 以源码分发；后续可发布 `npx minilab` CLI 包，把体验做到和主流 CLI 工具一致。

## 注意

- 网站上不要包含 `MiniLab-Development-Pack-v0.1/`（开发包是内部资料，随源码一起推公开仓库前先删掉或 `.gitignore` 掉）。
- 网站文案里的测试数（353）、SPEC 编号、端口（3000）请随仓库实际状态更新。
