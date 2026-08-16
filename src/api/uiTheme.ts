import type { TaskStatus } from '../domain/task';
import { VERSION } from '../version';

/**
 * Shared browser-UI theme (productization layer, outside the SPEC pipeline).
 * Everything the server-rendered pages have in common lives here: the MiniLab
 * brand mark (inline SVG), favicon, the full CSS design system, and the page
 * header/footer shells. `dashboardView` and `uiView` compose these so the
 * whole product surface stays visually consistent from a single source.
 *
 * Pure functions / static strings only — no state, no I/O. Every lab/agent/
 * project string is HTML-escaped by the callers (or here, in the shell).
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/**
 * Inline MiniLab logo (flask in an indigo→cyan rounded square). Used in the
 * page header. The gradient `id` is unique to this page instance because the
 * mark is inlined once per page.
 */
export const BRAND_MARK = `<svg class="brand-logo" viewBox="0 0 512 512" role="img" aria-label="MiniLab"><defs><linearGradient id="mlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#06B6D4"/></linearGradient></defs><rect x="31" y="31" width="450" height="450" rx="112" fill="url(#mlg)"/><path d="M154 113 H358 V348 Q358 369 337 369 H175 Q154 369 154 348 Z" fill="#ffffff"/><path d="M166 266 H346 V341 Q346 362 325 362 H187 Q166 362 166 341 Z" fill="#38BDF8"/><rect x="162" y="258" width="188" height="9" rx="4" fill="#ffffff"/><circle cx="215" cy="230" r="11" fill="#ffffff"/><circle cx="256" cy="200" r="8" fill="#ffffff"/><circle cx="297" cy="230" r="9" fill="#ffffff"/></svg>`;

/** Compact flat version for browser-tab favicon (data URI, self-contained). */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="31" y="31" width="450" height="450" rx="112" fill="#4F46E5"/><path d="M154 113 H358 V348 Q358 369 337 369 H175 Q154 369 154 348 Z" fill="#ffffff"/><path d="M166 266 H346 V341 Q346 362 325 362 H187 Q166 362 166 341 Z" fill="#38BDF8"/><rect x="162" y="258" width="188" height="9" rx="4" fill="#ffffff"/><circle cx="215" cy="230" r="11" fill="#ffffff"/><circle cx="256" cy="200" r="8" fill="#ffffff"/><circle cx="297" cy="230" r="9" fill="#ffffff"/></svg>`;

export const FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`;

export function faviconTag(): string {
  return `<link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}" />`;
}

// ---------------------------------------------------------------------------
// Escaping + label maps
// ---------------------------------------------------------------------------

/** Escapes user-authored text for safe HTML embedding. */
export function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    explore: '探索',
    survey: '综述',
    ideate: '构思',
    validate: '验证',
    develop: '开发',
    analyze: '分析',
    write: '撰写',
    submit: '提交',
    revise: '修订',
  };
  return labels[stage] ?? stage;
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    planned: '计划中',
    active: '进行中',
    blocked: '受阻',
    paused: '暂停',
    completed: '已完成',
    archived: '已归档',
    backlog: '待办',
    ready: '就绪',
    running: '执行中',
    review: '待审核',
    cancelled: '已取消',
    scheduled: '已排期',
    in_progress: '进行中',
  };
  return labels[status] ?? status;
}

export function priorityLabel(priority: string): string {
  const labels: Record<string, string> = {
    urgent: '紧急',
    high: '高',
    medium: '中',
    low: '低',
  };
  return labels[priority] ?? priority;
}

/**
 * Task workflow labels (S1 IA). The domain statuses already map 1:1 onto the
 * product's workflow (Backlog → To Do → Doing → Review/Waiting-for-PI → Done +
 * Blocked), so these are pure display labels — no status/migration change.
 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: '待办池',
  ready: 'To Do',
  running: 'Doing',
  review: '⏳ 等待 PI',
  blocked: '阻塞',
  completed: '完成',
  cancelled: '已取消',
};

/** Task badge label: the workflow label, falling back to the generic map. */
export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] ?? statusLabel(status);
}

// ---------------------------------------------------------------------------
// Design system (CSS)
// ---------------------------------------------------------------------------

/**
 * Design-system tokens, light by default. `data-theme="light"` pins light even
 * in a dark OS; `data-theme="dark"` pins dark; with no attribute the page
 * follows `prefers-color-scheme`. All component rules read these tokens, so the
 * theme preference applies uniformly across every server-rendered page.
 */
const LIGHT_TOKENS = `
  --bg: #f5f7fb;
  --panel: #ffffff;
  --card-soft: #fbfcff;
  --soft: #f3f6fb;
  --soft-hover: #eef0fb;
  --border: #e3e8f1;
  --border-soft: #eef1f6;
  --border-strong: #cdd6ef;
  --ghost-border: #c9d2f0;
  --input-border: #d3dbe9;
  --input-bg: #ffffff;
  --text: #1c2333;
  --input-text: #1c2333;
  --muted: #66738c;
  --faint: #8a94a6;
  --label: #46536b;
  --link: #4a5cd4;
  --accent: #4f46e5;
  --accent2: #6366f1;
  --accent-hover: #eef0fb;
  --danger: #b3261e;
  --danger-bg: #fdecea;
  --danger-border: #f6c8c2;
  --ok-bg: #e7f6ed;
  --ok-text: #167a41;
  --ok-border: #bfe6cd;
  --badge-danger-bg: #fdecea; --badge-danger-text: #b3261e; --badge-danger-border: #f6cfc9;
  --badge-info-bg: #e7f3ff; --badge-info-text: #0b5cad; --badge-info-border: #c9e2ff;
  --badge-ok-bg: #e6f6ec; --badge-ok-text: #1a7f45; --badge-ok-border: #bfe6cd;
  --badge-neutral-bg: #eef1f6; --badge-neutral-text: #5a6a80; --badge-neutral-border: #e1e6ee;`;

const DARK_TOKENS = `
  --bg: #0f1624;
  --panel: #171f33;
  --card-soft: #141c2d;
  --soft: #1b2436;
  --soft-hover: #222c44;
  --border: #293350;
  --border-soft: #2a3550;
  --border-strong: #3a4a72;
  --ghost-border: #3a4a72;
  --input-border: #2a3550;
  --input-bg: #0f1624;
  --text: #e6eaf2;
  --input-text: #e6eaf2;
  --muted: #8a94a6;
  --faint: #6b7689;
  --label: #b7c1d4;
  --link: #8fa0ef;
  --accent: #6366f1;
  --accent2: #818cf8;
  --accent-hover: #222c44;
  --danger: #ffb4a8;
  --danger-bg: #4a2421;
  --danger-border: #5f312c;
  --ok-bg: #1c3a2a;
  --ok-text: #9fd8b5;
  --ok-border: #274d38;
  --badge-danger-bg: #4a2421; --badge-danger-text: #ffb4a8; --badge-danger-border: #5f312c;
  --badge-info-bg: #1b2f4d; --badge-info-text: #a8c8ef; --badge-info-border: #27405f;
  --badge-ok-bg: #1c3a2a; --badge-ok-text: #9fd8b5; --badge-ok-border: #274d38;
  --badge-neutral-bg: #2a3550; --badge-neutral-text: #b7c1d4; --badge-neutral-border: #38445f;`;

export const THEME_CSS = `
  :root { color-scheme: light dark; ${LIGHT_TOKENS} }
  :root[data-theme="dark"] { color-scheme: dark; ${DARK_TOKENS} }
  :root[data-theme="light"] { color-scheme: light; ${LIGHT_TOKENS} }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { color-scheme: dark; ${DARK_TOKENS} }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    line-height: 1.55;
    background: var(--bg);
    color: var(--text);
    transition: background 0.2s ease, color 0.2s ease;
  }
  a { color: var(--link); }

  /* --- Brand header --- */
  header.top {
    position: sticky; top: 0; z-index: 10;
    background: linear-gradient(120deg, #4338ca, #4f46e5 48%, #0e9ec0);
    color: #fff;
    padding: 0.8rem 1.5rem;
    display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap;
    box-shadow: 0 2px 14px rgba(31, 41, 90, 0.28);
  }
  .brand-logo { width: 30px; height: 30px; border-radius: 8px; display: block; flex: none; }
  a.brand { display: inline-flex; align-items: center; gap: 0.55rem; color: #fff; text-decoration: none; font-weight: 800; font-size: 1.06rem; letter-spacing: 0.01em; }
  .brand-sub { font-weight: 600; opacity: 0.92; }
  header.top .crumb { opacity: 0.7; font-size: 0.9rem; }
  header.top .crumb a { color: inherit; text-decoration: none; }
  header.top .brand-spacer { flex: 1; }
  header.top .version { font-size: 0.72rem; opacity: 0.85; background: rgba(255,255,255,0.16); border: 1px solid rgba(255,255,255,0.25); padding: 0.14rem 0.55rem; border-radius: 999px; }

  main { max-width: 1080px; margin: 0 auto; padding: 1.1rem 1.5rem 3rem; }

  /* --- Hero band (dashboard) --- */
  .hero { padding: 1.1rem 0 0.1rem; }
  .hero h1 { margin: 0 0 0.2rem; font-size: 1.5rem; font-weight: 800; }
  .hero p { margin: 0; color: var(--muted); font-size: 0.95rem; }

  /* --- KPI stat cards --- */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.8rem; margin: 1.1rem 0; }
  .stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 0.9rem 1.05rem; box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.05); }
  .stat-card .stat-num { font-size: 1.55rem; font-weight: 800; background: linear-gradient(120deg, #4f46e5, #06b6d4); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .stat-card .stat-label { color: var(--muted); font-size: 0.82rem; margin-top: 0.1rem; }
  .stat-card .stat-extra { color: var(--faint); font-size: 0.72rem; }

  /* --- Flash --- */
  .flash { padding: 0.7rem 1rem; border-radius: 10px; margin: 0.75rem 0; font-size: 0.92rem; display: flex; gap: 0.45rem; align-items: center; }
  .flash.error { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); }
  .flash.ok { background: var(--ok-bg); color: var(--ok-text); border: 1px solid var(--ok-border); }

  /* --- Panels --- */
  section.panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 1.1rem 1.35rem;
    margin: 1rem 0;
    box-shadow: 0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.05);
  }
  section.panel > h2 { margin: 0 0 0.8rem; font-size: 1.02rem; font-weight: 700; display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  section.panel > h2 .muted { font-size: 0.8rem; font-weight: 400; }

  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 0.45rem 0; border-bottom: 1px solid var(--border-soft); }
  li:last-child { border-bottom: none; }
  li.empty { color: var(--muted); font-style: italic; }
  .muted { color: var(--muted); }

  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.55rem; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 0.85rem; }

  .badge { display: inline-block; padding: 0.08rem 0.55rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; margin-right: 0.35rem; border: 1px solid transparent; }
  .status-blocked, .status-review, .status-running, .status-failed { background: var(--badge-danger-bg); color: var(--badge-danger-text); border-color: var(--badge-danger-border); }
  .status-active, .status-in_progress, .status-ready, .status-retryable, .status-scheduled { background: var(--badge-info-bg); color: var(--badge-info-text); border-color: var(--badge-info-border); }
  .status-completed, .status-succeeded { background: var(--badge-ok-bg); color: var(--badge-ok-text); border-color: var(--badge-ok-border); }
  .status-planned, .status-backlog, .status-paused, .status-cancelled, .status-inactive, .status-archived { background: var(--badge-neutral-bg); color: var(--badge-neutral-text); border-color: var(--badge-neutral-border); }

  /* --- Agent identity cards --- */
  .agent-card {
    display: flex; gap: 0.95rem; align-items: flex-start;
    border: 1px solid var(--border); border-left: 4px solid #4f46e5;
    border-radius: 12px; padding: 0.85rem 1.05rem; margin: 0.6rem 0;
    background: var(--card-soft); box-shadow: 0 1px 2px rgba(16,24,40,0.04);
  }
  .agent-avatar {
    width: 42px; height: 42px; border-radius: 50%;
    background: linear-gradient(135deg, #4f46e5, #06b6d4);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1.1rem; flex: none;
    box-shadow: 0 2px 6px rgba(79,70,229,0.35);
  }
  .agent-name { font-weight: 700; }
  .agent-tasks { margin-top: 0.4rem; }
  .agent-tasks li { border: none; padding: 0.15rem 0; }

  .meeting-link { margin-left: 0.5rem; color: var(--link); text-decoration: none; font-size: 0.85rem; }

  /* --- Buttons --- */
  .btn {
    display: inline-flex; align-items: center; gap: 0.35rem;
    background: linear-gradient(120deg, #4f46e5, #6366f1);
    color: #fff; border: 0; border-radius: 9px; padding: 0.5rem 1rem;
    font-size: 0.88rem; font-weight: 600; cursor: pointer; text-decoration: none;
    box-shadow: 0 1px 3px rgba(79,70,229,0.3);
    transition: filter 0.15s ease, transform 0.05s ease;
  }
  .btn:hover { filter: brightness(1.08); }
  .btn:active { transform: translateY(1px); }
  .btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--ghost-border); box-shadow: none; }
  .btn.ghost:hover { background: var(--accent-hover); filter: none; }
  .btn.danger { background: var(--danger); box-shadow: none; }
  .btn.danger:hover { filter: brightness(1.08); }
  .btn.sm { padding: 0.3rem 0.65rem; font-size: 0.8rem; }

  /* --- Forms --- */
  details { margin: 0.4rem 0; }
  details > summary { cursor: pointer; padding: 0.5rem 0.7rem; border-radius: 9px; background: var(--soft); border: 1px solid var(--border); font-weight: 600; font-size: 0.92rem; list-style: none; }
  details > summary::marker, details > summary::-webkit-details-marker { display: none; }
  details > summary::after { content: "▾"; float: right; opacity: 0.5; transition: transform 0.15s ease; }
  details[open] > summary::after { transform: rotate(180deg); }
  details[open] > summary { background: var(--accent-hover); border-color: var(--border-strong); }
  form.field { display: grid; grid-template-columns: 130px 1fr; gap: 0.6rem 0.8rem; align-items: center; margin: 0.6rem 0; }
  form.field label { font-size: 0.88rem; color: var(--label); }
  form.field input[type="text"], form.field input[type="url"], form.field input[type="password"], form.field textarea, form.field select,
  .inline-form select, .inline-form input[type="text"], .run-form input[type="text"] {
    width: 100%; padding: 0.48rem 0.65rem; border: 1px solid var(--input-border); border-radius: 9px; font: inherit; background: var(--input-bg); color: var(--input-text);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  form.field textarea { min-height: 3.2rem; resize: vertical; }
  form.field input:focus, form.field textarea:focus, form.field select:focus, .inline-form select:focus, .inline-form input:focus, .run-form input:focus { outline: none; border-color: var(--accent2); box-shadow: 0 0 0 3px rgba(99,102,241,0.16); }
  form.field .actions { grid-column: 2; }
  .checks { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; }
  .checks label { font-size: 0.9rem; }
  .inline-form { display: inline-block; margin: 0; }
  .inline-form select, .inline-form input[type="text"] { width: auto; padding: 0.28rem 0.45rem; font-size: 0.8rem; }
  .run-form { display: inline-flex; gap: 0.4rem; align-items: center; }
  .run-form input[type="text"] { width: 12rem; font-size: 0.8rem; padding: 0.28rem 0.45rem; }

  pre.content { white-space: pre-wrap; word-break: break-word; background: var(--soft); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem; margin: 0.4rem 0; }
  .avatar { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg, #4f46e5, #06b6d4); color: #fff; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; margin-right: 0.4rem; vertical-align: middle; }
  .meta-line { color: var(--muted); font-size: 0.85rem; margin: 0.2rem 0; }

  footer { text-align: center; color: var(--faint); font-size: 0.8rem; margin-top: 2.5rem; }
  footer .footer-brand { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; color: var(--label); }
  footer .footer-logo { width: 18px; height: 18px; border-radius: 5px; }
`;

/**
 * Global app frame (S1 IA): a fixed left sidebar (Today / Projects / Activities /
 * Lab / Memory + Settings) next to a scrolling content column. Styling mirrors the
 * settings left-nav pattern (`.settings-nav`) so the whole surface stays coherent.
 */
const APP_FRAME_CSS = `
  .app-layout { display: grid; grid-template-columns: 224px 1fr; min-height: 100vh; }
  .side-nav {
    background: var(--panel); border-right: 1px solid var(--border);
    padding: 1rem 0.8rem 1.2rem; display: flex; flex-direction: column; gap: 0.18rem;
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }
  .side-nav .nav-brand { display: flex; align-items: center; gap: 0.55rem; padding: 0.1rem 0.55rem 0.85rem; font-weight: 800; font-size: 1.02rem; color: var(--text); text-decoration: none; border-bottom: 1px solid var(--border-soft); margin-bottom: 0.6rem; }
  .side-nav .nav-logo { width: 26px; height: 26px; border-radius: 7px; flex: none; }
  .side-nav a.nav-item { display: flex; align-items: center; gap: 0.55rem; padding: 0.52rem 0.8rem; border-radius: 10px; color: var(--text); text-decoration: none; font-size: 0.92rem; font-weight: 600; }
  .side-nav a.nav-item:hover { background: var(--soft); }
  .side-nav a.nav-item.active { background: var(--accent-hover); color: var(--accent); }
  .side-nav .nav-icon { width: 1.15rem; text-align: center; flex: none; }
  .side-nav .nav-spacer { flex: 1; }
  .side-nav a.nav-item.settings { margin-top: 0.6rem; border-top: 1px solid var(--border-soft); padding-top: 0.7rem; }
  .app-col { min-width: 0; }
  @media (max-width: 840px) {
    .app-layout { grid-template-columns: 1fr; }
    .side-nav { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.2rem; border-right: none; border-bottom: 1px solid var(--border); padding: 0.5rem 0.8rem; }
    .side-nav .nav-brand { display: none; }
    .side-nav .nav-spacer { display: none; }
    .side-nav a.nav-item.settings { margin-top: 0; border-top: none; padding-top: 0.52rem; }
  }
`;

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export interface BrandHeaderOptions {
  labName: string | null;
  title: string;
}

export function brandHeader(o: BrandHeaderOptions): string {
  return `<header class="top">
  <a class="brand" href="/">${BRAND_MARK}<span>MiniLab</span></a>
  ${o.labName ? `<span class="brand-sub">${escapeHtml(o.labName)}</span>` : ''}
  <span class="crumb">/ ${escapeHtml(o.title)}</span>
  <span class="brand-spacer"></span>
  <span class="version">v${VERSION}</span>
</header>`;
}

/**
 * `data-theme` attribute for the `<html>` element. `system` (or unknown/missing)
 * emits nothing so the page follows `prefers-color-scheme`; explicit light/dark
 * pins the theme on every page.
 */
export function themeAttr(theme?: string): string {
  if (theme === 'light' || theme === 'dark') return ` data-theme="${theme}"`;
  return '';
}

export function siteFooter(tagline?: string): string {
  const sub = tagline ? ` · ${escapeHtml(tagline)}` : '';
  return `<footer>
  <div class="footer-brand">${BRAND_MARK.replace('class="brand-logo"', 'class="brand-logo footer-logo"')}MiniLab${sub}</div>
  <div>本地持久化 AI 科研实验室 · v${VERSION}</div>
</footer>`;
}

// ---------------------------------------------------------------------------
// Global app frame (left sidebar navigation)
// ---------------------------------------------------------------------------

/** Top-level navigation keys (S1 IA: Today / Projects / Activities / Lab / Memory). */
export type NavKey = 'today' | 'projects' | 'activities' | 'lab' | 'memory' | 'settings';

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; icon: string; label: string }> = [
  { key: 'today', href: '/', icon: '▣', label: 'Today' },
  { key: 'projects', href: '/projects', icon: '◇', label: 'Projects' },
  { key: 'activities', href: '/activities', icon: '◉', label: 'Activities' },
  { key: 'lab', href: '/lab', icon: '♙', label: 'Lab' },
  { key: 'memory', href: '/memory', icon: '▤', label: 'Memory' },
];

/** Maps a URL path to its sidebar entry (path-prefix matching, highest precedence first). */
export function navKeyForPath(path: string): NavKey | null {
  if (!path) return null;
  if (path === '/' || path.startsWith('/labs/')) return 'today'; // legacy lab dashboard = Lab Pulse
  if (path.startsWith('/projects')) return 'projects';
  if (path.startsWith('/meetings') || path.startsWith('/activities')) return 'activities';
  if (path.startsWith('/agents') || path.startsWith('/lab')) return 'lab';
  if (path.startsWith('/memory')) return 'memory';
  if (path.startsWith('/ui/settings')) return 'settings';
  return null;
}

export interface AppFrameOptions {
  /** Short crumb shown after the brand in the header (e.g. "PI Dashboard"). */
  crumb: string;
  /** Full document <title> (tab text); defaults to `${crumb} · MiniLab`. */
  docTitle?: string;
  /** Current Lab name shown next to the brand (null hides it). */
  labName: string | null;
  /** Request path — picks the active sidebar entry. */
  path: string;
  /** Body content, rendered inside <main>. */
  body: string;
  error?: string | null;
  notice?: string | null;
  theme?: string;
  /** Extra <style> appended after THEME_CSS (page-specific CSS). */
  extraCss?: string;
  /** Extra markup injected before </body> (e.g. the dashboard's inline voice JS). */
  extraBody?: string;
  /** Footer tagline (e.g. the dashboard's "deterministic read model" note). */
  tagline?: string;
}

/**
 * The shared application frame (S1 IA): a left sidebar with the five top-level
 * entries + Settings, and a content column holding the brand header, <main> and
 * footer. Every authenticated page goes through this so navigation and theming
 * stay consistent; `navKeyForPath` picks the highlighted entry.
 */
export function appFrame(o: AppFrameOptions): string {
  const active = navKeyForPath(o.path);
  const navLinks = NAV_ITEMS.map(
    (n) =>
      `<a class="nav-item${active === n.key ? ' active' : ''}" href="${n.href}"><span class="nav-icon">${n.icon}</span>${escapeHtml(n.label)}</a>`,
  ).join('');
  const settingsLink = `<a class="nav-item settings${active === 'settings' ? ' active' : ''}" href="/ui/settings"><span class="nav-icon">⚙</span>设置</a>`;
  const docTitle = o.docTitle ?? `${o.crumb} · MiniLab`;
  return `<!doctype html>
<html lang="zh-CN"${themeAttr(o.theme)}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(docTitle)}</title>
${faviconTag()}
<style>${THEME_CSS}${APP_FRAME_CSS}${o.extraCss ?? ''}</style>
</head>
<body>
<div class="app-layout">
  <aside class="side-nav">
    <a class="nav-brand" href="/">${BRAND_MARK.replace('class="brand-logo"', 'class="brand-logo nav-logo"')}MiniLab</a>
    ${navLinks}
    <span class="nav-spacer"></span>
    ${settingsLink}
  </aside>
  <div class="app-col">
    ${brandHeader({ labName: o.labName, title: o.crumb })}
    ${o.tagline ? `<p class="muted" style="margin:0 0 1rem;font-size:0.85rem;">${escapeHtml(o.tagline)}</p>` : ''}
    <main>
      ${o.error ? `<div class="flash error">⚠ ${escapeHtml(o.error)}</div>` : ''}
      ${o.notice ? `<div class="flash ok">✓ ${escapeHtml(o.notice)}</div>` : ''}
      ${o.body}
    </main>
    ${siteFooter()}
  </div>
</div>
${o.extraBody ?? ''}
</body>
</html>`;
}
