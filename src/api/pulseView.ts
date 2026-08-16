import type { LabPulse, PulsePerson, PulseProject } from '../application/labPulseService';
import {
  escapeHtml,
  stageLabel,
  statusLabel,
  taskStatusLabel,
  priorityLabel,
  appFrame,
} from './uiTheme';

/**
 * Today / Lab Pulse page (S1 IA) — the default home. Answers the two questions
 * the product is built around, in four ordered blocks:
 *   Needs your attention → Lab progress → People → Today schedule.
 * A pure function over the canonical `LabPulse` read model (no model calls).
 * Every user-authored string is HTML-escaped; links go to the existing detail
 * pages.
 */
export interface TodayPageOptions {
  theme?: string;
  error?: string | null;
  notice?: string | null;
}

const PULSE_CSS = `
  .pulse-hero { padding: 1.1rem 0 0.1rem; }
  .pulse-hero h1 { margin: 0 0 0.2rem; font-size: 1.5rem; font-weight: 800; }
  .pulse-hero p { margin: 0; color: var(--muted); font-size: 0.95rem; }
  .group-lab { font-weight: 700; font-size: 0.95rem; margin: 0.5rem 0 0.2rem; color: var(--label); }
  .pulse-progress { height: 8px; border-radius: 999px; background: var(--soft); overflow: hidden; margin: 0.45rem 0 0.15rem; }
  .pulse-progress > span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #4f46e5, #06b6d4); }
  .pulse-progress-label { display: flex; justify-content: space-between; color: var(--faint); font-size: 0.78rem; }
  .person-card { display: flex; gap: 0.8rem; align-items: flex-start; border: 1px solid var(--border); border-left: 4px solid #06b6d4; border-radius: 12px; padding: 0.8rem 1rem; margin: 0.6rem 0; background: var(--card-soft); box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
  .person-body { flex: 1; min-width: 0; }
  .person-name { font-weight: 700; }
  .person-tasks { margin-top: 0.35rem; }
  .person-tasks li { border: none; padding: 0.15rem 0; font-size: 0.9rem; }
  .person-meta { color: var(--muted); font-size: 0.85rem; margin-top: 0.1rem; }
`;

function renderAttention(attention: LabPulse['attention']): string {
  if (
    attention.tasks.length === 0 &&
    attention.questions.length === 0 &&
    attention.hints.length === 0
  ) {
    return '<li class="empty">没有需要你关注的事 ✅</li>';
  }
  const items: string[] = [];
  for (const t of attention.tasks) {
    items.push(`<li>
      <span class="badge status-${escapeHtml(t.status)}">${taskStatusLabel(t.status)}</span>
      <a href="/projects/${escapeHtml(t.projectId)}#task-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a>
      <span class="muted">· ${escapeHtml(t.projectTitle)} · 派给 ${escapeHtml(t.assigneeName)} · ${priorityLabel(t.priority)}优先级 · ${escapeHtml(t.labName)}</span>
    </li>`);
  }
  for (const q of attention.questions) {
    items.push(`<li>❓ <strong>${escapeHtml(q.question)}</strong> <span class="muted">· ${escapeHtml(q.agentName)} 就「${escapeHtml(q.taskTitle)}」提出 · ${escapeHtml(q.labName)}</span></li>`);
  }
  for (const h of attention.hints) {
    items.push(`<li>💡 ${escapeHtml(h.agentName)}<span class="muted">（${escapeHtml(h.labName)}）手上有 ${h.openCount} 个待办/待审任务，但当前没有 Doing 任务 —— 需要你判断下一步</span></li>`);
  }
  return items.join('');
}

function renderLabProgress(labProgress: PulseProject[]): string {
  if (labProgress.length === 0) {
    return '<li class="empty">还没有进行中的项目。</li>';
  }
  const byLab = new Map<string, PulseProject[]>();
  for (const p of labProgress) {
    const list = byLab.get(p.labId);
    if (list) list.push(p);
    else byLab.set(p.labId, [p]);
  }
  return [...byLab.entries()]
    .map(
      ([, projects]) => `
    <div class="group-lab">🏛 ${escapeHtml(projects[0].labName)}</div>
    <ul>${projects
      .map(
        (p) => `<li>
      <div>
        <a href="/projects/${escapeHtml(p.projectId)}">${escapeHtml(p.title)}</a>
        <span class="badge status-${escapeHtml(p.status)}">${statusLabel(p.status)}</span>
        <span class="badge status-ready">${stageLabel(p.stage)}</span>
      </div>
      <div class="pulse-progress"><span style="width:${Math.max(0, Math.min(100, p.progress))}%"></span></div>
      <div class="pulse-progress-label"><span>${p.progress}% 任务完成</span><span>更新于 ${escapeHtml(p.updatedAt.slice(0, 10))}</span></div>
    </li>`,
      )
      .join('')}</ul>`,
    )
    .join('');
}

function renderPeople(people: PulsePerson[]): string {
  if (people.length === 0) {
    return '<li class="empty">还没有成员。先在某个实验室雇佣第一位成员。</li>';
  }
  const byLab = new Map<string, PulsePerson[]>();
  for (const agent of people) {
    const list = byLab.get(agent.labId);
    if (list) list.push(agent);
    else byLab.set(agent.labId, [agent]);
  }
  return [...byLab.entries()]
    .map(
      ([, agents]) => `
    <div class="group-lab">🏛 ${escapeHtml(agents[0].labName)}</div>
    ${agents
      .map((a) => {
        const taskLis: string[] = [];
        for (const t of a.doing) {
          taskLis.push(`<li><span class="badge status-running">Doing</span><a href="/projects/${escapeHtml(t.projectId)}#task-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a><span class="muted"> · ${escapeHtml(t.projectTitle)}</span></li>`);
        }
        for (const t of a.next) {
          taskLis.push(`<li><span class="badge status-ready">Next</span><a href="/projects/${escapeHtml(t.projectId)}#task-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a><span class="muted"> · ${escapeHtml(t.projectTitle)}</span></li>`);
        }
        const meta = [
          a.blockedCount > 0 ? `${a.blockedCount} 阻塞` : '',
          a.awaitingPiCount > 0 ? `${a.awaitingPiCount} 等待 PI` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return `<div class="person-card">
      <div class="person-body">
        <div class="person-name"><a href="/agents/${escapeHtml(a.agentId)}">${escapeHtml(a.name)}</a> ${meta ? `<span class="badge status-review">${escapeHtml(meta)}</span>` : ''}</div>
        <div class="person-meta">${escapeHtml(a.role)}${a.specialization ? ` · ${escapeHtml(a.specialization)}` : ''}</div>
        <ul class="person-tasks">${taskLis.length === 0 ? '<li class="empty">空闲中 —— 没有 Doing 任务</li>' : taskLis.join('')}</ul>
      </div>
    </div>`;
      })
      .join('')}`,
    )
    .join('');
}

function renderTodaySchedule(todaySchedule: LabPulse['todaySchedule']): string {
  if (todaySchedule.length === 0) {
    return '<li class="empty">今天没有组会安排。</li>';
  }
  return todaySchedule
    .map(
      (m) => `<li>
        <span class="badge status-${escapeHtml(m.status)}">${statusLabel(m.status)}</span>
        <a href="/meetings/${escapeHtml(m.id)}">${escapeHtml(m.title)}</a>
        <span class="muted">· ${escapeHtml(m.projectTitle)} · ${escapeHtml(m.labName)} · 开始于 ${escapeHtml((m.startedAt ?? '').slice(0, 19).replace('T', ' '))}</span>
      </li>`,
    )
    .join('');
}

export function renderTodayPage(pulse: LabPulse, extra?: TodayPageOptions): string {
  const body = `
    <div class="pulse-hero">
      <h1>🗓 Today · Lab Pulse</h1>
      <p>实验室现在在干什么？我现在需要做什么？—— 打开即是答案。</p>
    </div>

    <section class="panel">
      <h2>⚠️ 需要你关注 <span class="muted">（${pulse.attention.tasks.length} 个任务 · ${pulse.attention.questions.length} 个问题 · ${pulse.attention.hints.length} 条提示）</span></h2>
      <ul>${renderAttention(pulse.attention)}</ul>
    </section>

    <section class="panel">
      <h2>📈 实验室进度 <span class="muted">（${pulse.labProgress.length} 个进行中项目）</span></h2>
      <ul>${renderLabProgress(pulse.labProgress)}</ul>
    </section>

    <section class="panel">
      <h2>👥 谁在干什么 <span class="muted">（${pulse.people.length} 位成员 · People View）</span></h2>
      ${renderPeople(pulse.people)}
    </section>

    <section class="panel">
      <h2>🗓 今日安排 <span class="muted">（${pulse.todaySchedule.length} 场）</span></h2>
      <ul>${renderTodaySchedule(pulse.todaySchedule)}</ul>
    </section>
  `;

  return appFrame({
    crumb: 'Today',
    docTitle: 'Today · Lab Pulse',
    labName: null,
    path: '/',
    error: extra?.error ?? null,
    notice: extra?.notice ?? null,
    theme: extra?.theme,
    extraCss: PULSE_CSS,
    body,
  });
}
