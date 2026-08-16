import type { User } from '../domain/user';
import type { ModelConfigView } from '../domain/modelConfig';
import { escapeHtml, appFrame } from './uiTheme';
import { VERSION } from '../version';

/**
 * Settings center (user center). Six tabs — 常规 / 个人资料 / 语音 / 配置 /
 * 个性化 / 账户 — each rendered as a server-side form posting to `/ui/settings/*`.
 * Pure function like every view: the route composes authorized data and hands it
 * in. No inline JS; the accent-color/density prefs are stored for the design
 * system's next iteration (theme is the live part today).
 */

export type SettingsTab = 'general' | 'profile' | 'voice' | 'config' | 'personalize' | 'account';

export interface SettingsLabConfigs {
  lab: { id: string; name: string };
  configs: ModelConfigView[];
}

export interface SettingsPageData {
  user: User;
  tab: SettingsTab;
  error?: string | null;
  notice?: string | null;
  labsWithConfigs: SettingsLabConfigs[];
  dashScopeReady: boolean;
  dataDir: string | null;
  port: number | null;
}

const TABS: Array<{ key: SettingsTab; label: string; icon: string }> = [
  { key: 'general', label: '常规', icon: '⚙️' },
  { key: 'profile', label: '个人资料', icon: '👤' },
  { key: 'voice', label: '语音', icon: '🎤' },
  { key: 'config', label: '配置', icon: '🔌' },
  { key: 'personalize', label: '个性化', icon: '🎨' },
  { key: 'account', label: '账户', icon: '🔐' },
];

const SETTINGS_CSS = `
  .settings h1 { font-size: 1.5rem; font-weight: 800; margin: 1.1rem 0 0.2rem; }
  .settings .sub { color: var(--muted); margin: 0 0 1rem; }
  .settings-layout { display: grid; grid-template-columns: 210px 1fr; gap: 1.2rem; align-items: start; }
  @media (max-width: 760px) { .settings-layout { grid-template-columns: 1fr; } }
  .settings-nav { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 0.6rem; display: flex; flex-direction: column; gap: 0.15rem; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
  .settings-nav a { display: flex; align-items: center; gap: 0.55rem; padding: 0.55rem 0.8rem; border-radius: 10px; color: var(--text); text-decoration: none; font-size: 0.92rem; font-weight: 600; }
  .settings-nav a:hover { background: var(--soft); }
  .settings-nav a.active { background: var(--accent-hover); color: var(--accent); }
  .settings-panel { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 1.3rem 1.5rem; box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.05); }
  .settings-panel h2 { margin: 0 0 0.4rem; font-size: 1.1rem; font-weight: 800; }
  .settings-panel .panel-sub { color: var(--muted); font-size: 0.88rem; margin: 0 0 1.1rem; }
  .settings-panel form.field { margin: 0.8rem 0; }
  .settings-panel .hint { font-size: 0.82rem; color: var(--muted); margin-top: 0.9rem; line-height: 1.6; }
  .settings-panel .info-row { display: flex; gap: 0.6rem; padding: 0.45rem 0; border-bottom: 1px solid var(--border-soft); font-size: 0.9rem; }
  .settings-panel .info-row .k { width: 120px; flex: none; color: var(--muted); font-weight: 600; }
  .settings-panel .info-row .v { color: var(--text); word-break: break-all; }
  .settings-panel .divider { border: none; border-top: 1px solid var(--border-soft); margin: 1.4rem 0; }
  .settings-panel .config-row { padding: 0.7rem 0; border-bottom: 1px solid var(--border-soft); }
  .settings-panel .config-row:last-child { border-bottom: none; }
  .settings-panel .config-lab { font-weight: 700; font-size: 0.95rem; margin: 0.6rem 0 0.2rem; color: var(--label); }
  .settings-panel .config-meta { color: var(--muted); font-size: 0.82rem; margin: 0.15rem 0 0.4rem; }
  .settings-panel .config-actions { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
  .settings-panel .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem 1rem; }
  @media (max-width: 760px) { .settings-panel .field-grid { grid-template-columns: 1fr; } }
`;

const selected = (current: string | undefined, value: string): string => (current === value ? ' selected' : '');
const checked = (flag: boolean | undefined): string => (flag ? ' checked' : '');

function generalTab(user: User, data: SettingsPageData): string {
  const prefs = user.preferences.general ?? {};
  const infoRows = [
    ['版本', `MiniLab v${VERSION}`],
    ...(data.port ? [['端口', String(data.port)]] : []),
    ...(data.dataDir ? [['数据目录', data.dataDir]] : []),
  ].map(([k, v]) => `<div class="info-row"><span class="k">${k}</span><span class="v">${escapeHtml(v)}</span></div>`);
  return `<div class="settings-panel">
    <h2>⚙️ 常规</h2>
    <p class="panel-sub">界面语言与启动行为</p>
    <form class="field" method="post" action="/ui/settings/general">
      <label>界面语言</label>
      <select name="language">
        <option value="zh-CN"${selected(prefs.language, 'zh-CN')}>简体中文</option>
        <option value="en"${selected(prefs.language, 'en')}>English</option>
      </select>
      <label>启动最小化到托盘</label>
      <div class="checks">
        <label><input type="checkbox" name="startMinimized" value="1"${checked(prefs.startMinimized)} /> 开机进入托盘而非主窗口</label>
      </div>
      <div class="actions"><button class="btn" type="submit">保存常规设置</button></div>
    </form>
    <hr class="divider" />
    <h2>环境信息</h2>
    <div>${infoRows.join('')}</div>
  </div>`;
}

function profileTab(user: User, _data: SettingsPageData): string {
  return `<div class="settings-panel">
    <h2>👤 个人资料</h2>
    <p class="panel-sub">主页与列表里显示的称呼</p>
    <form class="field" method="post" action="/ui/settings/profile">
      <label>显示名</label>
      <input type="text" name="displayName" maxlength="80" value="${escapeHtml(user.displayName ?? '')}" placeholder="你的称呼" />
      <label>头像（Emoji）</label>
      <input type="text" name="avatar" maxlength="8" value="${escapeHtml(user.avatar ?? '')}" placeholder="如 🧑‍🔬" />
      <label>简介</label>
      <textarea name="bio" maxlength="500" placeholder="一句话介绍自己">${escapeHtml(user.bio ?? '')}</textarea>
      <div class="actions"><button class="btn" type="submit">保存资料</button></div>
    </form>
  </div>`;
}

function voiceTab(user: User, _data: SettingsPageData): string {
  const prefs = user.preferences.voice ?? {};
  return `<div class="settings-panel">
    <h2>🎤 语音</h2>
    <p class="panel-sub">朗读（TTS）与录音转写（ASR）偏好</p>
    <form class="field" method="post" action="/ui/settings/voice">
      <label>启用语音</label>
      <div class="checks">
        <label><input type="checkbox" name="enabled" value="1"${checked(prefs.enabled)} /> 在仪表盘显示语音按钮</label>
      </div>
      <label>朗读音色</label>
      <select name="ttsVoice">
        <option value="longxiaochun"${selected(prefs.ttsVoice, 'longxiaochun')}>晓辰（女声）</option>
        <option value="longxiaoxia"${selected(prefs.ttsVoice, 'longxiaoxia')}>晓霞（女声）</option>
        <option value="longshu"${selected(prefs.ttsVoice, 'longshu')}>书适（男声）</option>
        <option value="longchen"${selected(prefs.ttsVoice, 'longchen')}>龙辰（男声）</option>
      </select>
      <label>朗读语速</label>
      <div class="field-grid">
        <input type="number" name="ttsSpeed" min="0.5" max="2" step="0.1" value="${escapeHtml(prefs.ttsSpeed?.toString() ?? '1.0')}" />
        <span class="muted">0.5 – 2.0（1.0 为正常语速）</span>
      </div>
      <label>识别语言</label>
      <select name="asrLanguage">
        <option value="zh"${selected(prefs.asrLanguage, 'zh')}>中文</option>
        <option value="en"${selected(prefs.asrLanguage, 'en')}>英文</option>
      </select>
      <div class="actions"><button class="btn" type="submit">保存语音设置</button></div>
    </form>
    <p class="hint">语音由阿里云百炼（DashScope）提供。请先在「配置」分区连接一个 DashScope 兼容模型，并确认账号已开通语音识别 / 语音合成权限。</p>
  </div>`;
}

function configTab(_user: User, data: SettingsPageData): string {
  const rows = data.labsWithConfigs
    .map((group) => {
      const configRows = group.configs.length
        ? group.configs
            .map((c) => {
              const keyBadge = c.apiKeyConfigured
                ? '<span class="badge status-completed">已配置密钥</span>'
                : '<span class="badge status-planned">未配置密钥</span>';
              return `<div class="config-row">
                <div><strong>${escapeHtml(c.name)}</strong> ${keyBadge} <span class="config-meta">${escapeHtml(c.provider)} · ${escapeHtml(c.model)}</span></div>
                <div class="config-meta">${escapeHtml(c.baseUrl ?? '')}</div>
                <div class="config-actions">
                  <form class="inline-form" method="post" action="/ui/settings/config/test">
                    <input type="hidden" name="modelConfigId" value="${escapeHtml(c.id)}" />
                    <button class="btn sm ghost" type="submit">▶ 测试连接</button>
                  </form>
                  <a class="btn sm ghost" href="/labs/${escapeHtml(group.lab.id)}/dashboard">到实验室配置</a>
                </div>
              </div>`;
            })
            .join('')
        : '<li class="empty">该实验室尚未配置模型</li>';
      return `<div class="config-lab">🏛 ${escapeHtml(group.lab.name)}</div>
        <ul>${configRows}</ul>`;
    })
    .join('');
  const dashScopeBadge = data.dashScopeReady
    ? '<span class="badge status-completed">已连接 DashScope</span>'
    : '<span class="badge status-planned">未连接 DashScope</span>';
  return `<div class="settings-panel">
    <h2>🔌 配置</h2>
    <p class="panel-sub">模型连接与语音服务来源</p>
    <div class="info-row"><span class="k">DashScope 语音</span><span class="v">${dashScopeBadge} 朗读 / 识别复用 DashScope 兼容模型的密钥</span></div>
    <hr class="divider" />
    <h2>模型配置</h2>
    <div>${rows}</div>
    <p class="hint">密钥以加密形式存储，仅用于调用模型；不会在页面中明文展示。</p>
  </div>`;
}

function personalizeTab(user: User, _data: SettingsPageData): string {
  const prefs = user.preferences.personalize ?? {};
  return `<div class="settings-panel">
    <h2>🎨 个性化</h2>
    <p class="panel-sub">外观偏好</p>
    <form class="field" method="post" action="/ui/settings/personalize">
      <label>主题</label>
      <select name="theme">
        <option value="system"${selected(prefs.theme, 'system')}>跟随系统</option>
        <option value="light"${selected(prefs.theme, 'light')}>浅色</option>
        <option value="dark"${selected(prefs.theme, 'dark')}>深色</option>
      </select>
      <label>强调色</label>
      <select name="accentColor">
        <option value="indigo"${selected(prefs.accentColor, 'indigo')}>靛蓝（默认）</option>
        <option value="cyan"${selected(prefs.accentColor, 'cyan')}>青</option>
        <option value="green"${selected(prefs.accentColor, 'green')}>绿</option>
        <option value="amber"${selected(prefs.accentColor, 'amber')}>琥珀</option>
      </select>
      <label>界面密度</label>
      <select name="density">
        <option value="comfortable"${selected(prefs.density, 'comfortable')}>标准</option>
        <option value="compact"${selected(prefs.density, 'compact')}>紧凑</option>
      </select>
      <div class="actions"><button class="btn" type="submit">保存外观</button></div>
    </form>
    <p class="hint">强调色与密度目前作为偏好保存，将在后续版本逐步应用到全界面。主题对全站立即生效。</p>
  </div>`;
}

function accountTab(user: User, _data: SettingsPageData): string {
  const created = new Date(user.createdAt).toLocaleString('zh-CN');
  return `<div class="settings-panel">
    <h2>🔐 账户</h2>
    <p class="panel-sub">账号信息与安全</p>
    <div class="info-row"><span class="k">用户名</span><span class="v">${escapeHtml(user.username)}</span></div>
    <div class="info-row"><span class="k">角色</span><span class="v">${escapeHtml(user.role)}</span></div>
    <div class="info-row"><span class="k">创建时间</span><span class="v">${escapeHtml(created)}</span></div>
    <hr class="divider" />
    <h2>修改密码</h2>
    <form class="field" method="post" action="/ui/settings/password">
      <label>当前密码</label>
      <input type="password" name="currentPassword" required autocomplete="current-password" />
      <label>新密码</label>
      <input type="password" name="newPassword" required minlength="6" autocomplete="new-password" />
      <label>确认新密码</label>
      <input type="password" name="newPasswordConfirm" required autocomplete="new-password" />
      <div class="actions"><button class="btn" type="submit">修改密码</button></div>
    </form>
    <hr class="divider" />
    <form class="field" method="post" action="/ui/settings/logout">
      <div class="actions"><button class="btn danger" type="submit">退出登录</button></div>
    </form>
    <p class="hint">忘记密码时需手动清除数据目录中的 users 表记录后重新设置（本软件为本地单机设计，不提供找回流程）。</p>
  </div>`;
}

const TAB_RENDERERS: Record<SettingsTab, (user: User, data: SettingsPageData) => string> = {
  general: generalTab,
  profile: profileTab,
  voice: voiceTab,
  config: configTab,
  personalize: personalizeTab,
  account: accountTab,
};

export function renderSettingsPage(data: SettingsPageData): string {
  const nav = TABS.map(
    (t) => `<a class="${t.key === data.tab ? 'active' : ''}" href="/ui/settings?tab=${t.key}">${t.icon} ${escapeHtml(t.label)}</a>`,
  ).join('');
  const body = `
  <div class="settings">
    <h1>设置中心</h1>
    <p class="sub">${escapeHtml(data.user.displayName ?? data.user.username)} 的本地 MiniLab</p>
    <div class="settings-layout">
      <aside class="settings-nav">${nav}</aside>
      <div>${TAB_RENDERERS[data.tab](data.user, data)}</div>
    </div>
  </div>`;
  return appFrame({
    crumb: '设置中心',
    docTitle: '设置中心 · MiniLab',
    labName: null,
    path: '/ui/settings',
    error: data.error ?? null,
    notice: data.notice ?? null,
    theme: data.user.preferences.personalize?.theme,
    extraCss: SETTINGS_CSS,
    body,
  });
}
