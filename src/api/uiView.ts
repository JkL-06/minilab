import type { Agent } from '../domain/agent';
import type { AgentRun } from '../domain/agentRun';
import type { Artifact } from '../domain/artifact';
import type { Meeting } from '../domain/meeting';
import type { MeetingDetail } from '../application/meetingService';
import type { Memory } from '../domain/memory';
import type { Project } from '../domain/project';
import type { Task } from '../domain/task';
import { TASK_STATUS_TRANSITIONS } from '../domain/task';
import { escapeHtml, stageLabel, statusLabel, priorityLabel } from './dashboardView';

/**
 * Server-rendered detail pages for the browser UI layer (productization, outside
 * the SPEC pipeline): project / meeting / agent pages and a shared page shell.
 * Like the SPEC-010 dashboard view, these are pure functions — the routes
 * compose canonical data and hand it in, so a page can never read state the
 * services haven't already authorized.
 *
 * Every user-authored string is HTML-escaped (XSS safety). No inline JS and no
 * external assets: forms are plain `method="post"` submissions to `/ui/*`.
 */

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

export interface PageOptions {
  title: string;
  labName: string | null;
  error?: string | null;
  notice?: string | null;
  body: string;
}

const SHELL_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.5; background: #f4f6f9; color: #1c2333; }
  header.top { background: #0f1b2d; color: #fff; padding: 0.9rem 1.5rem; display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; }
  header.top a.brand { color: #fff; text-decoration: none; font-weight: 700; }
  header.top .crumb { opacity: 0.7; font-size: 0.9rem; }
  main { max-width: 1080px; margin: 0 auto; padding: 1.25rem 1.5rem 3rem; }
  .flash { padding: 0.6rem 1rem; border-radius: 8px; margin: 0.75rem 0; font-size: 0.92rem; }
  .flash.error { background: #fdecea; color: #b3261e; border: 1px solid #f5c6c0; }
  .flash.ok { background: #e6f6ec; color: #1a7f45; border: 1px solid #bfe6cd; }
  section.panel { background: #fff; border: 1px solid #e2e6ee; border-radius: 10px; padding: 1rem 1.25rem; margin: 1rem 0; }
  section.panel h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 0.4rem 0; border-bottom: 1px solid #eef1f6; }
  li:last-child { border-bottom: none; }
  li.empty { color: #6b7a90; font-style: italic; }
  .muted { color: #6b7a90; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid #eef1f6; vertical-align: top; }
  th { color: #6b7a90; font-weight: 600; font-size: 0.85rem; }
  .badge { display: inline-block; padding: 0.08rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; margin-right: 0.35rem; }
  .status-blocked, .status-review, .status-running, .status-failed { background: #fdecea; color: #b3261e; }
  .status-active, .status-in_progress, .status-ready, .status-retryable, .status-scheduled { background: #e7f3ff; color: #0b5cad; }
  .status-completed, .status-succeeded { background: #e6f6ec; color: #1a7f45; }
  .status-planned, .status-backlog, .status-paused, .status-cancelled, .status-inactive, .status-archived { background: #eef1f6; color: #5a6a80; }
  a { color: #0b5cad; }
  .btn { display: inline-block; background: #0b5cad; color: #fff; border: 0; border-radius: 8px; padding: 0.45rem 0.9rem; font-size: 0.88rem; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #094a8f; }
  .btn.ghost { background: transparent; color: #0b5cad; border: 1px solid #0b5cad; }
  .btn.danger { background: #b3261e; }
  .btn.sm { padding: 0.25rem 0.6rem; font-size: 0.8rem; }
  form.field { display: grid; grid-template-columns: 130px 1fr; gap: 0.55rem 0.8rem; align-items: center; margin: 0.5rem 0; }
  form.field label { font-size: 0.88rem; color: #46536b; }
  form.field input[type="text"], form.field input[type="url"], form.field input[type="password"], form.field textarea, form.field select { width: 100%; padding: 0.45rem 0.6rem; border: 1px solid #c9d2e0; border-radius: 8px; font: inherit; }
  form.field textarea { min-height: 3.2rem; resize: vertical; }
  form.field .actions { grid-column: 2; }
  .checks { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; }
  .checks label { font-size: 0.9rem; }
  .inline-form { display: inline-block; margin: 0; }
  .inline-form select, .inline-form input[type="text"] { padding: 0.25rem 0.45rem; border: 1px solid #c9d2e0; border-radius: 6px; font-size: 0.8rem; }
  .run-form { display: inline-flex; gap: 0.4rem; align-items: center; }
  .run-form input[type="text"] { padding: 0.25rem 0.45rem; border: 1px solid #c9d2e0; border-radius: 6px; font-size: 0.8rem; width: 12rem; }
  pre.content { white-space: pre-wrap; word-break: break-word; background: #f7f9fc; border: 1px solid #e6eaf1; border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem; margin: 0.4rem 0; }
  .avatar { display: inline-flex; width: 26px; height: 26px; border-radius: 50%; background: #0b5cad; color: #fff; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem; margin-right: 0.4rem; }
  .meta-line { color: #6b7a90; font-size: 0.85rem; margin: 0.2rem 0; }
  footer { text-align: center; color: #8a94a6; font-size: 0.8rem; margin-top: 2rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #131a26; color: #e6eaf2; }
    section.panel { background: #1b2436; border-color: #2a3550; }
    li, th, td { border-color: #2a3550; }
    .muted, th { color: #8a94a6; }
    .status-planned, .status-backlog, .status-paused, .status-cancelled, .status-inactive, .status-archived { background: #2a3550; color: #b7c1d4; }
    .status-blocked, .status-review, .status-running, .status-failed { background: #4a2421; color: #ffb4a8; }
    .status-active, .status-in_progress, .status-ready, .status-retryable, .status-scheduled { background: #1b2f4d; color: #a8c8ef; }
    .status-completed, .status-succeeded { background: #1c3a2a; color: #9fd8b5; }
    pre.content { background: #141c2b; border-color: #2a3550; }
    form.field input[type="text"], form.field input[type="url"], form.field input[type="password"], form.field textarea, form.field select, .inline-form select, .inline-form input[type="text"], .run-form input[type="text"] { background: #131a26; color: #e6eaf2; border-color: #2a3550; }
  }
`;

export function pageShell(o: PageOptions): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(o.title)} · MiniLab</title>
<style>${SHELL_CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="/">🏛 ${escapeHtml(o.labName ?? 'MiniLab')}</a>
  <span class="crumb">/ ${escapeHtml(o.title)}</span>
</header>
<main>
  ${o.error ? `<div class="flash error">⚠ ${escapeHtml(o.error)}</div>` : ''}
  ${o.notice ? `<div class="flash ok">✓ ${escapeHtml(o.notice)}</div>` : ''}
  ${o.body}
</main>
<footer>MiniLab · 本地持久化 AI 科研实验室</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Project page
// ---------------------------------------------------------------------------

export interface ProjectPageTask extends Task {
  agentName: string;
}

export interface ProjectPageData {
  project: Project;
  lab: { id: string; name: string };
  agents: Agent[];
  tasks: ProjectPageTask[];
  artifacts: Artifact[];
  meetings: Meeting[];
  error?: string | null;
  notice?: string | null;
}

const TERMINAL_TASK_STATUSES: readonly string[] = ['completed', 'cancelled'];

export function renderProjectPage(data: ProjectPageData): string {
  const { project, lab } = data;

  const taskRows = data.tasks
    .map((t) => {
      const nextOptions = TASK_STATUS_TRANSITIONS[t.status]
        .filter((s) => s !== t.status)
        .map((s) => `<option value="${s}">${statusLabel(s)}</option>`)
        .join('');
      const isTerminal = TERMINAL_TASK_STATUSES.includes(t.status);
      const runControl = isTerminal
        ? '<span class="muted">已结束</span>'
        : `<form class="run-form" method="post" action="/ui/tasks/${escapeHtml(t.id)}/run">
             <input type="hidden" name="_return" value="/projects/${escapeHtml(project.id)}" />
             <input type="text" name="instruction" placeholder="额外指令（可选）" />
             <button class="btn sm" type="submit">▶ 执行</button>
           </form>
           <form class="inline-form" method="post" action="/ui/tasks/${escapeHtml(t.id)}/status">
             <input type="hidden" name="_return" value="/projects/${escapeHtml(project.id)}" />
             <select name="status">${nextOptions}</select>
             <button class="btn sm ghost" type="submit">改状态</button>
           </form>`;
      return `<tr id="task-${escapeHtml(t.id)}">
        <td>
          <strong>${escapeHtml(t.title)}</strong>
          ${t.description ? `<div class="muted">${escapeHtml(t.description)}</div>` : ''}
          <div class="meta-line">派给 ${escapeHtml(t.agentName)} · ${priorityLabel(t.priority)}优先级 · 更新于 ${escapeHtml(t.updatedAt.slice(0, 19).replace('T', ' '))}</div>
        </td>
        <td><span class="badge status-${escapeHtml(t.status)}">${statusLabel(t.status)}</span></td>
        <td>${runControl}</td>
      </tr>`;
    })
    .join('');

  const artifactRows = data.artifacts
    .map(
      (a) => `<tr>
        <td><strong>${escapeHtml(a.title)}</strong><div class="meta-line">${escapeHtml(a.type)} · v${escapeHtml(a.version)}${a.creatorAgentId ? ` · 由 ${escapeHtml(data.agents.find((x) => x.id === a.creatorAgentId)?.name ?? '?')} 产出` : ''} · ${escapeHtml(a.createdAt.slice(0, 19).replace('T', ' '))}</div></td>
        <td><pre class="content">${escapeHtml(a.content.slice(0, 400))}${a.content.length > 400 ? ' …' : ''}</pre></td>
      </tr>`,
    )
    .join('');

  const meetingRows = data.meetings
    .map(
      (m) => `<li>
        <span class="badge status-${escapeHtml(m.status)}">${statusLabel(m.status)}</span>
        <a href="/meetings/${escapeHtml(m.id)}">${escapeHtml(m.title)}</a>
        <span class="muted">· ${escapeHtml(m.updatedAt.slice(0, 19).replace('T', ' '))}</span>
      </li>`,
    )
    .join('');

  const assigneeOptions = data.agents
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
    .join('');
  const participantChecks = data.agents
    .map(
      (a) =>
        `<label><input type="checkbox" name="participantAgentIds" value="${escapeHtml(a.id)}" /> ${escapeHtml(a.name)}</label>`,
    )
    .join('');

  const body = `
    <section class="panel">
      <h2>${escapeHtml(project.title)}</h2>
      <div>
        <span class="badge status-${escapeHtml(project.status)}">${statusLabel(project.status)}</span>
        <span class="badge status-ready">${stageLabel(project.stage)}</span>
        <a class="btn ghost sm" href="/labs/${escapeHtml(lab.id)}/export">⬇ 导出为 Markdown</a>
        <a class="btn ghost sm" href="/labs/${escapeHtml(lab.id)}/dashboard">返回仪表盘</a>
      </div>
      ${project.objective ? `<p>${escapeHtml(project.objective)}</p>` : ''}
    </section>

    <section class="panel">
      <h2>⚡ 快速操作</h2>
      <details>
        <summary>➕ 派发任务</summary>
        <form class="field" method="post" action="/ui/projects/${escapeHtml(project.id)}/tasks">
          <input type="hidden" name="_return" value="/projects/${escapeHtml(project.id)}" />
          <label>任务标题</label><input type="text" name="title" required maxlength="300" placeholder="例如：综述 Transformer 注意力机制对比" />
          <label>任务描述</label><textarea name="description" maxlength="10000" placeholder="（可选）背景、要求、交付物…"></textarea>
          <label>派给</label>
          <select name="assigneeAgentId" required>${data.agents.length === 0 ? '<option value="">（还没有成员，请先雇佣）</option>' : assigneeOptions}</select>
          <label>优先级</label>
          <select name="priority"><option value="medium">中</option><option value="urgent">紧急</option><option value="high">高</option><option value="low">低</option></select>
          <div class="actions"><button class="btn" type="submit">创建任务</button></div>
        </form>
      </details>
      <details>
        <summary>🗓 发起组会</summary>
        <form class="field" method="post" action="/ui/projects/${escapeHtml(project.id)}/meetings">
          <input type="hidden" name="_return" value="/projects/${escapeHtml(project.id)}" />
          <label>会议主题</label><input type="text" name="title" required maxlength="300" placeholder="例如：中期进展同步" />
          <label>议程</label><textarea name="agenda" maxlength="20000" placeholder="（可选）要讨论什么…"></textarea>
          <label>参会成员</label>
          <div class="checks">${data.agents.length === 0 ? '<span class="muted">（还没有成员可参会）</span>' : participantChecks}</div>
          <div class="actions"><button class="btn" type="submit">创建组会</button></div>
        </form>
      </details>
    </section>

    <section class="panel">
      <h2>📋 任务（${data.tasks.length}）</h2>
      ${data.tasks.length === 0 ? '<p class="muted">还没有任务。用上面的「派发任务」派给一位成员。</p>' : `<table>
        <thead><tr><th>任务</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${taskRows}</tbody>
      </table>`}
    </section>

    <section class="panel">
      <h2>📦 产物（${data.artifacts.length}）</h2>
      ${data.artifacts.length === 0 ? '<p class="muted">暂无产物。成员执行任务后会自动沉淀这里。</p>' : `<table>
        <thead><tr><th>产物</th><th>内容预览</th></tr></thead>
        <tbody>${artifactRows}</tbody>
      </table>`}
    </section>

    <section class="panel">
      <h2>🗓 组会（${data.meetings.length}）</h2>
      ${data.meetings.length === 0 ? '<p class="muted">还没有组会。</p>' : `<ul>${meetingRows}</ul>`}
    </section>
  `;

  return pageShell({
    title: project.title,
    labName: lab.name,
    error: data.error ?? null,
    notice: data.notice ?? null,
    body,
  });
}

// ---------------------------------------------------------------------------
// Meeting page
// ---------------------------------------------------------------------------

export interface MeetingPageData {
  detail: MeetingDetail;
  lab: { id: string; name: string };
  error?: string | null;
  notice?: string | null;
}

export function renderMeetingPage(data: MeetingPageData): string {
  const { detail, lab } = data;
  const meeting = detail.meeting;

  const participantList = detail.participants
    .map((p) => `<li><span class="avatar" aria-hidden="true">${escapeHtml(p.name.charAt(0))}</span>${escapeHtml(p.name)}</li>`)
    .join('');

  const updateList = detail.updates
    .map((u) => {
      const agentName = detail.participants.find((p) => p.agentId === u.agentId)?.name ?? '?';
      return `<li><strong>${escapeHtml(agentName)}</strong> 的更新<div class="meta-line">${escapeHtml(u.content)}</div></li>`;
    })
    .join('');

  const decisionList = detail.decisions
    .map(
      (d) => `<li><strong>${escapeHtml(d.statement)}</strong>${d.rationale ? `<div class="muted">理由：${escapeHtml(d.rationale)}</div>` : ''}<div class="meta-line">由 PI 于 ${escapeHtml(d.createdAt.slice(0, 19).replace('T', ' '))} 记录</div></li>`,
    )
    .join('');

  const actionItemList = detail.actionItems
    .map((item) => {
      const assigneeName = detail.participants.find((p) => p.agentId === item.assigneeAgentId)?.name;
      const taskLink = item.taskId
        ? `<a href="/projects/${escapeHtml(detail.project.id)}#task-${escapeHtml(item.taskId)}">已生成任务 →</a>`
        : item.assigneeAgentId
          ? `<form class="inline-form" method="post" action="/ui/meetings/${escapeHtml(meeting.id)}/action-items/${escapeHtml(item.id)}/task">
               <input type="hidden" name="_return" value="/meetings/${escapeHtml(meeting.id)}" />
               <button class="btn sm ghost" type="submit">生成任务</button>
             </form>`
          : '<span class="muted">未指派</span>';
      return `<li>${escapeHtml(item.title)}<div class="meta-line">${assigneeName ? `派给 ${escapeHtml(assigneeName)} · ` : ''}${taskLink}</div></li>`;
    })
    .join('');

  const resultingTaskLinks = detail.resultingTaskIds
    .map((id) => `<a href="/projects/${escapeHtml(detail.project.id)}#task-${escapeHtml(id)}">${escapeHtml(id.slice(0, 8))}…</a>`)
    .join(' · ');

  let actions = '';
  if (meeting.status === 'scheduled') {
    actions = `<form class="inline-form" method="post" action="/ui/meetings/${escapeHtml(meeting.id)}/start">
      <input type="hidden" name="_return" value="/meetings/${escapeHtml(meeting.id)}" />
      <button class="btn" type="submit">▶ 开始会议</button>
    </form>`;
  } else if (meeting.status === 'in_progress') {
    actions = `
      <details>
        <summary>📝 记录决策</summary>
        <form class="field" method="post" action="/ui/meetings/${escapeHtml(meeting.id)}/decisions">
          <input type="hidden" name="_return" value="/meetings/${escapeHtml(meeting.id)}" />
          <label>决策内容</label><input type="text" name="statement" required maxlength="5000" placeholder="例如：本期改用 RAG 路线，先做检索评估" />
          <label>理由</label><textarea name="rationale" maxlength="5000" placeholder="（可选）…"></textarea>
          <div class="actions"><button class="btn" type="submit">记录决策</button></div>
        </form>
      </details>
      <details>
        <summary>🎯 添加行动项</summary>
        <form class="field" method="post" action="/ui/meetings/${escapeHtml(meeting.id)}/action-items">
          <input type="hidden" name="_return" value="/meetings/${escapeHtml(meeting.id)}" />
          <label>行动项</label><input type="text" name="title" required maxlength="300" placeholder="例如：整理三篇基线论文的对比表" />
          <label>派给</label>
          <select name="assigneeAgentId">
            <option value="">（仅记录，不指派）</option>
            ${detail.participants.map((p) => `<option value="${escapeHtml(p.agentId)}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <div class="actions"><button class="btn" type="submit">添加行动项</button></div>
        </form>
      </details>
      <form class="inline-form" method="post" action="/ui/meetings/${escapeHtml(meeting.id)}/complete">
        <input type="hidden" name="_return" value="/meetings/${escapeHtml(meeting.id)}" />
        <button class="btn danger" type="submit">✔ 完成组会并写入记忆</button>
      </form>`;
  }

  const body = `
    <section class="panel">
      <h2>${escapeHtml(meeting.title)}</h2>
      <div>
        <span class="badge status-${escapeHtml(meeting.status)}">${statusLabel(meeting.status)}</span>
        <a href="/projects/${escapeHtml(detail.project.id)}">${escapeHtml(detail.project.title)}</a>
        ${meeting.startedAt ? `<span class="muted">· 开始于 ${escapeHtml(meeting.startedAt.slice(0, 19).replace('T', ' '))}</span>` : ''}
        ${meeting.endedAt ? `<span class="muted">· 结束于 ${escapeHtml(meeting.endedAt.slice(0, 19).replace('T', ' '))}</span>` : ''}
      </div>
      ${meeting.agenda ? `<p class="muted">议程：${escapeHtml(meeting.agenda)}</p>` : ''}
      ${actions}
    </section>

    <section class="panel">
      <h2>👥 参会成员（${detail.participants.length}）</h2>
      <ul>${participantList}</ul>
    </section>

    <section class="panel">
      <h2>📤 成员更新（${detail.updates.length}）</h2>
      ${detail.updates.length === 0 ? '<p class="muted">暂无更新。</p>' : `<ul>${updateList}</ul>`}
    </section>

    <section class="panel">
      <h2>🧭 决策（${detail.decisions.length}）</h2>
      ${detail.decisions.length === 0 ? '<p class="muted">还没有记录决策。</p>' : `<ul>${decisionList}</ul>`}
    </section>

    <section class="panel">
      <h2>🎯 行动项（${detail.actionItems.length}）</h2>
      ${detail.actionItems.length === 0 ? '<p class="muted">还没有行动项。</p>' : `<ul>${actionItemList}</ul>`}
    </section>

    <section class="panel">
      <h2>✅ 结果（${detail.resultingTaskIds.length} 个跟进任务 · ${detail.memoryWriteIds.length} 条记忆写入）</h2>
      ${detail.resultingTaskIds.length === 0 ? '<p class="muted">完成组会后这里会出现跟进任务与写入的记忆。</p>' : `<p>跟进任务：${resultingTaskLinks}</p>`}
    </section>
  `;

  return pageShell({
    title: meeting.title,
    labName: lab.name,
    error: data.error ?? null,
    notice: data.notice ?? null,
    body,
  });
}

// ---------------------------------------------------------------------------
// Agent page
// ---------------------------------------------------------------------------

export interface AgentPageData {
  agent: Agent;
  lab: { id: string; name: string };
  tasks: Array<{ id: string; title: string; status: string; projectId: string; projectTitle: string; updatedAt: string }>;
  runs: AgentRun[];
  memories: Memory[];
  modelConfigs: Array<{ id: string; name: string; model: string; provider: string }>;
  error?: string | null;
  notice?: string | null;
}

function runStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    succeeded: '成功',
    retryable: '可重试',
    failed: '失败',
  };
  return labels[status] ?? status;
}

export function renderAgentPage(data: AgentPageData): string {
  const { agent, lab } = data;

  const taskRows = data.tasks
    .map(
      (t) => `<li>
        <span class="badge status-${escapeHtml(t.status)}">${statusLabel(t.status)}</span>
        <a href="/projects/${escapeHtml(t.projectId)}#task-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a>
        <span class="muted">· ${escapeHtml(t.projectTitle)} · 更新于 ${escapeHtml(t.updatedAt.slice(0, 19).replace('T', ' '))}</span>
      </li>`,
    )
    .join('');

  const runRows = data.runs
    .map((r) => {
      const line =
        r.status === 'succeeded' && r.result
          ? r.result.summary
          : r.errorCategory
            ? `失败原因：${r.errorCategory}`
            : '—';
      return `<tr>
        <td><span class="badge status-${escapeHtml(r.status)}">${runStatusLabel(r.status)}</span>${escapeHtml(r.id.slice(0, 8))}…</td>
        <td>${escapeHtml(r.model ?? '—')}</td>
        <td>${escapeHtml(line.slice(0, 160))}</td>
        <td>${escapeHtml(r.endedAt.slice(0, 19).replace('T', ' '))}</td>
      </tr>`;
    })
    .join('');

  const memoryList = data.memories
    .map(
      (m) => `<li>
        <strong>[${escapeHtml(m.scope)}]</strong> ${escapeHtml(m.content.slice(0, 200))}${m.content.length > 200 ? '…' : ''}
        <div class="meta-line">来源 ${escapeHtml(m.sourceType)} · 重要度 ${escapeHtml(m.importance)} · ${escapeHtml(m.createdAt.slice(0, 19).replace('T', ' '))}</div>
      </li>`,
    )
    .join('');

  const configOptions = data.modelConfigs
    .map((c) => `<option value="${escapeHtml(c.id)}"${agent.modelConfigId === c.id ? ' selected' : ''}>${escapeHtml(c.name)}（${escapeHtml(c.model)}）</option>`)
    .join('');
  const configStatus = agent.modelConfigId
    ? `已连接 ${escapeHtml(data.modelConfigs.find((c) => c.id === agent.modelConfigId)?.name ?? agent.modelConfigId)}`
    : '未连接模型配置 —— 执行任务前需先连接';

  const body = `
    <section class="panel">
      <h2><span class="avatar" aria-hidden="true">${escapeHtml(agent.name.charAt(0))}</span> ${escapeHtml(agent.name)}</h2>
      <div>
        <span class="badge status-${escapeHtml(agent.status)}">${statusLabel(agent.status)}</span>
        <span class="muted">${escapeHtml(agent.role)}${agent.specialization ? ` · ${escapeHtml(agent.specialization)}` : ''}</span>
        <a class="btn ghost sm" href="/labs/${escapeHtml(lab.id)}/dashboard">返回仪表盘</a>
      </div>
      ${agent.profile ? `<p>${escapeHtml(agent.profile)}</p>` : ''}
    </section>

    <section class="panel">
      <h2>🔌 模型配置</h2>
      <p class="muted">${configStatus}</p>
      ${data.modelConfigs.length === 0
        ? '<p class="muted">还没有模型配置。先到仪表盘「连接模型」，再回来指派给这个成员。</p>'
        : `<form class="field" method="post" action="/ui/agents/${escapeHtml(agent.id)}/model-config">
            <input type="hidden" name="_return" value="/agents/${escapeHtml(agent.id)}" />
            <label>指派模型</label>
            <select name="modelConfigId">
              <option value="">（清除指派）</option>
              ${configOptions}
            </select>
            <div class="actions"><button class="btn" type="submit">保存</button></div>
          </form>`}
    </section>

    <section class="panel">
      <h2>📋 名下任务（${data.tasks.length}）</h2>
      ${data.tasks.length === 0 ? '<p class="muted">这个成员名下还没有任务。</p>' : `<ul>${taskRows}</ul>`}
    </section>

    <section class="panel">
      <h2>🕐 执行记录（${data.runs.length}）</h2>
      ${data.runs.length === 0 ? '<p class="muted">还没有执行过任务。</p>' : `<table>
        <thead><tr><th>结果</th><th>模型</th><th>摘要</th><th>结束于</th></tr></thead>
        <tbody>${runRows}</tbody>
      </table>`}
    </section>

    <section class="panel">
      <h2>🧠 个人记忆（${data.memories.length}）</h2>
      ${data.memories.length === 0 ? '<p class="muted">暂无个人记忆。执行任务时模型建议的记忆候选会沉淀到这里。</p>' : `<ul>${memoryList}</ul>`}
    </section>
  `;

  return pageShell({
    title: agent.name,
    labName: lab.name,
    error: data.error ?? null,
    notice: data.notice ?? null,
    body,
  });
}
