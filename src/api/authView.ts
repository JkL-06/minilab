import { BRAND_MARK, THEME_CSS, escapeHtml, faviconTag } from './uiTheme';
import { VERSION } from '../version';

/**
 * Server-rendered pages for the unauthenticated part of the app: the login page
 * and the first-run setup page (creates the 0th user). These are standalone full
 * pages — no brand header/navigation, since the visitor is not signed in yet.
 */

interface AuthPageOptions {
  title: string;
  subtitle: string;
  body: string;
}

function authShell(o: AuthPageOptions): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(o.title)} · MiniLab</title>
${faviconTag()}
<style>${THEME_CSS}
  body.auth { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem; }
  .auth-card { background: var(--card-bg, #ffffff); border: 1px solid var(--card-border, #e3e8f1); border-radius: 20px; padding: 2.6rem 2.8rem; width: 100%; max-width: 420px; box-shadow: 0 8px 28px rgba(16,24,40,0.10); }
  .auth-logo { width: 64px; height: 64px; border-radius: 16px; margin: 0 auto 1.1rem; display: block; box-shadow: 0 4px 14px rgba(79,70,229,0.35); }
  .auth-card h1 { margin: 0 0 0.3rem; font-size: 1.45rem; font-weight: 800; text-align: center; }
  .auth-card .sub { text-align: center; color: var(--muted, #667085); font-size: 0.92rem; margin: 0 0 1.6rem; }
  .auth-card label { display: block; font-size: 0.85rem; font-weight: 600; margin: 1rem 0 0.35rem; }
  .auth-card input { width: 100%; box-sizing: border-box; padding: 0.62rem 0.8rem; border: 1px solid var(--input-border, #d0d7e2); border-radius: 10px; font-size: 0.95rem; background: var(--input-bg, #ffffff); color: var(--text, #101828); }
  .auth-card input:focus { outline: none; border-color: var(--accent, #4F46E5); box-shadow: 0 0 0 3px rgba(79,70,229,0.18); }
  .auth-card .actions { margin-top: 1.5rem; }
  .auth-card .btn { width: 100%; justify-content: center; }
  .flash { text-align: center; font-size: 0.9rem; padding: 0.55rem 0.9rem; border-radius: 10px; margin-bottom: 1rem; }
  .flash.error { background: rgba(229,72,77,0.10); color: #C0392B; border: 1px solid rgba(229,72,77,0.25); }
  .flash.ok { background: rgba(39,174,96,0.10); color: #1E8449; border: 1px solid rgba(39,174,96,0.25); }
  .auth-foot { text-align: center; margin-top: 1.4rem; font-size: 0.78rem; color: var(--muted, #98a2b3); }
</style>
</head>
<body class="auth">
<div class="auth-card">
  ${BRAND_MARK.replace('class="brand-logo"', 'class="brand-logo auth-logo"')}
  <h1>${escapeHtml(o.title)}</h1>
  <p class="sub">${escapeHtml(o.subtitle)}</p>
  ${o.body}
  <div class="auth-foot">MiniLab v${VERSION}</div>
</div>
</body>
</html>`;
}

export function renderLoginPage(options: {
  error?: string | null;
  notice?: string | null;
  returnTo?: string;
}): string {
  const returnField =
    options.returnTo && options.returnTo.startsWith('/')
      ? `<input type="hidden" name="return" value="${escapeHtml(options.returnTo)}" />`
      : '';
  const error = options.error ? `<div class="flash error">⚠ ${escapeHtml(options.error)}</div>` : '';
  const notice = options.notice ? `<div class="flash ok">✓ ${escapeHtml(options.notice)}</div>` : '';
  return authShell({
    title: '登录 MiniLab',
    subtitle: '本机账号密码登录',
    body: `${error}${notice}
      <form method="post" action="/auth/login">
        ${returnField}
        <label>用户名</label>
        <input type="text" name="username" required autocomplete="username" maxlength="32" autofocus />
        <label>密码</label>
        <input type="password" name="password" required autocomplete="current-password" />
        <div class="actions"><button class="btn primary" type="submit">登录</button></div>
      </form>`,
  });
}

export function renderSetupPage(options: { error?: string | null }): string {
  const error = options.error ? `<div class="flash error">⚠ ${escapeHtml(options.error)}</div>` : '';
  return authShell({
    title: '欢迎使用 MiniLab',
    subtitle: '首次设置：创建本机第一个账号（0 号用户 / 管理员）',
    body: `${error}
      <form method="post" action="/setup">
        <label>用户名</label>
        <input type="text" name="username" required maxlength="32" placeholder="如 jkl" autofocus />
        <label>显示名（可选）</label>
        <input type="text" name="displayName" maxlength="80" placeholder="你的称呼" />
        <label>密码</label>
        <input type="password" name="password" required minlength="6" autocomplete="new-password" />
        <label>确认密码</label>
        <input type="password" name="passwordConfirm" required autocomplete="new-password" />
        <div class="actions"><button class="btn primary" type="submit">创建账号并进入</button></div>
      </form>`,
  });
}
