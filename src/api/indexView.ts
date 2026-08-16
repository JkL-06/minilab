import type { Agent } from '../domain/agent';
import type { Meeting } from '../domain/meeting';
import type { Memory } from '../domain/memory';
import type { Project } from '../domain/project';
import { TASK_STATUS_TRANSITIONS, type Task } from '../domain/task';
import {
  appFrame,
  escapeHtml,
  stageLabel,
  statusLabel,
  taskStatusLabel,
} from './uiTheme';

/**
 * Sidebar index pages + the task People View (S1 IA). Thin, server-rendered,
 * Accept-gated list pages over the existing per-lab/per-project services (no
 * `findAll()` repo methods — aggregation iterates labs → projects, ADR-0006 #4).
 *
 * The five nav destinations are Today (home), Projects, Activities, Lab,
 * Memory; each index page is a flat list linking to the existing detail pages,
 * so nothing here duplicates behavior.
 */

// ---------------------------------------------------------------------------
// Index rows (view-only: canonical rows + the lab they live in)
// ---------------------------------------------------------------------------

export interface IndexProjectRow {
  labId: string;
  labName: string;
  project: Project;
}

export interface IndexMeetingRow {
  labId: string;
  labName: string;
  projectId: string;
  projectTitle: string;
  meeting: Meeting;
}

export interface IndexAgentRow {
  labId: string;
  labName: string;
  agent: Agent;
}

export interface IndexMemoryRow {
  labId: string;
  labName: string;
  memory: Memory;
}

interface PageExtra {
  theme?: string;
  error?: string | null;
  notice?: string | null;
}

const INDEX_CSS = `
  .index-group { font-weight: 700; font-size: 0.95rem; margin: 0.5rem 0 0.2rem; color: var(--label); }
  .project-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; }
  .index-meta { color: var(--muted); font-size: 0.82rem; }
  .view-switch { display: inline-flex; gap: 0.35rem; margin-bottom: 0.6rem; }
  .view-switch a.pill { padding: 0.3rem 0.8rem; border-radius: 999px; border: 1px solid var(--border); color: var(--text); text-decoration: none; font-size: 0.85rem; font-weight: 600; }
  .view-switch a.pill.active { background: var(--accent-hover); border-color: transparent; color: var(--accent); }
  .person-group { border: 1px solid var(--border); border-left: 4px solid #06b6d4; border-radius: 12px; padding: 0.8rem 1rem; margin: 0.6rem 0; background: var(--card-soft); }
  .person-group h3 { margin: 0 0 0.3rem; font-size: 1rem; }
  .bucket { margin-top: 0.55rem; }
  .bucket-title { font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--faint); margin-bottom: 0.2rem; }
  .bucket-tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .task-chip { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 0.28rem 0.55rem; font-size: 0.86rem; }
  .task-chip form.inline-form { display: inline-flex; gap: 0.3rem; }
  .task-chip select { padding: 0.1rem 0.2rem; font-size: 0.8rem; }
  .kanban-cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.8rem; }
  .kanban-col { background: var(--card-soft); border: 1px solid var(--border); border-radius: 12px; padding: 0.7rem 0.8rem; }
  .kanban-col h3 { margin: 0 0 0.4rem; font-size: 0.9rem; }
  .kanban-col ul { list-style: none; margin: 0; padding: 0; }
  .kanban-col li { padding: 0.32rem 0; border-bottom: 1px dashed var(--border-soft); font-size: 0.88rem; }
`;

function groupByLab<T extends { labName: string }>(rows: T[]): Map<string, T[]> {
  const byLab = new Map<string, T[]>();
  for (const row of rows) {
    const list = byLab.get(row.labName);
    if (list) list.push(row);
    else byLab.set(row.labName, [row]);
  }
  return byLab;
}

// ---------------------------------------------------------------------------
// Projects index
// ---------------------------------------------------------------------------

export function renderProjectsIndex(rows: IndexProjectRow[], extra?: PageExtra): string {
  const body = rows.length === 0
    ? '<section class="panel"><h2>◇ Projects</h2><p class="muted">还没有项目。在某个实验室里创建第一个 Project。</p></section>'
    : [...groupByLab(rows).entries()]
        .map(
          ([labName, labRows]) => `
        <div class="index-group">🏛 ${escapeHtml(labName)}</div>
        <section class="panel"><ul>${labRows
          .map(
            (r) => `<li>
          <div class="project-row">
            <span>
              <a href="/projects/${escapeHtml(r.project.id)}">${escapeHtml(r.project.title)}</a>
              <span class="badge status-${escapeHtml(r.project.status)}">${statusLabel(r.project.status)}</span>
              <span class="badge status-ready">${stageLabel(r.project.stage)}</span>
            </span>
            <span class="index-meta">更新于 ${escapeHtml(r.project.updatedAt.slice(0, 10))}</span>
          </div>
          ${r.project.objective ? `<div class="muted">${escapeHtml(r.project.objective)}</div>` : ''}
        </li>`,
          )
          .join('')}</ul></section>`,
        )
        .join('');

  return appFrame({
    crumb: 'Projects',
    docTitle: 'Projects · MiniLab',
    labName: null,
    path: '/projects',
    error: extra?.error ?? null,
    notice: extra?.notice ?? null,
    theme: extra?.theme,
    extraCss: INDEX_CSS,
    body,
  });
}

// ---------------------------------------------------------------------------
// Activities index (Group Meetings, newest first)
// ---------------------------------------------------------------------------

export function renderActivitiesIndex(rows: IndexMeetingRow[], extra?: PageExtra): string {
  const body = rows.length === 0
    ? '<section class="panel"><h2>◉ Activities</h2><p class="muted">还没有组会。在某个项目的「发起组会」里创建第一场。</p></section>'
    : `<section class="panel"><ul>${rows
        .map(
          (r) => `<li>
        <span class="badge status-${escapeHtml(r.meeting.status)}">${statusLabel(r.meeting.status)}</span>
        <a href="/meetings/${escapeHtml(r.meeting.id)}">${escapeHtml(r.meeting.title)}</a>
        <span class="muted">· ${escapeHtml(r.projectTitle)} · ${escapeHtml(r.labName)} · ${escapeHtml(meetingWhen(r.meeting))}</span>
      </li>`,
        )
        .join('')}</ul></section>`;

  return appFrame({
    crumb: 'Activities',
    docTitle: 'Activities · MiniLab',
    labName: null,
    path: '/activities',
    error: extra?.error ?? null,
    notice: extra?.notice ?? null,
    theme: extra?.theme,
    extraCss: INDEX_CSS,
    body,
  });
}

/** Best available timestamp: startedAt when known, else createdAt. */
function meetingWhen(m: Meeting): string {
  const raw = m.startedAt ?? m.createdAt;
  return raw.slice(0, 19).replace('T', ' ');
}

// ---------------------------------------------------------------------------
// Lab index (member roster; the org tree is S4)
// ---------------------------------------------------------------------------

export function renderLabIndex(rows: IndexAgentRow[], extra?: PageExtra): string {
  const body = rows.length === 0
    ? '<section class="panel"><h2>♙ Lab</h2><p class="muted">还没有成员。在某个实验室里雇佣第一位成员。</p></section>'
    : [...groupByLab(rows).entries()]
        .map(
          ([labName, labRows]) => `
        <div class="index-group">🏛 ${escapeHtml(labName)}</div>
        <section class="panel"><ul>${labRows
          .map(
            (r) => `<li>
          <strong><a href="/agents/${escapeHtml(r.agent.id)}">${escapeHtml(r.agent.name)}</a></strong>
          <span class="badge status-${escapeHtml(r.agent.status)}">${r.agent.status === 'active' ? '在职' : '停用'}</span>
          <span class="muted">· ${escapeHtml(r.agent.role)}${r.agent.specialization ? ` · ${escapeHtml(r.agent.specialization)}` : ''}</span>
        </li>`,
          )
          .join('')}</ul></section>`,
        )
        .join('');

  return appFrame({
    crumb: 'Lab',
    docTitle: 'Lab · MiniLab',
    labName: null,
    path: '/lab',
    error: extra?.error ?? null,
    notice: extra?.notice ?? null,
    theme: extra?.theme,
    extraCss: INDEX_CSS,
    body,
  });
}

// ---------------------------------------------------------------------------
// Memory index (cross-lab, newest first)
// ---------------------------------------------------------------------------

const SCOPE_LABELS: Record<string, string> = {
  agent: '成员',
  project: '项目',
  team: '团队',
  lab: '实验室',
};

export function renderMemoryIndex(rows: IndexMemoryRow[], extra?: PageExtra): string {
  const body = rows.length === 0
    ? '<section class="panel"><h2>▤ Memory</h2><p class="muted">还没有记忆。组会完成、任务执行会自动沉淀；也可以随时记一条。</p></section>'
    : `<section class="panel"><ul>${rows
        .map((r) => {
          const m = r.memory;
          const scopeLabel = SCOPE_LABELS[m.scope] ?? m.scope;
          const source = memorySourceLink(m);
          return `<li>
          <div class="project-row">
            <span><strong>${escapeHtml(m.content.slice(0, 160))}${m.content.length > 160 ? '…' : ''}</strong></span>
            <span class="index-meta">${'★'.repeat(m.importance)}${'☆'.repeat(5 - m.importance)}</span>
          </div>
          <div class="muted">${escapeHtml(scopeLabel)}作用域 · 来源 ${source} · ${escapeHtml(r.labName)} · ${escapeHtml(m.createdAt.slice(0, 19).replace('T', ' '))}</div>
        </li>`;
        })
        .join('')}</ul></section>`;

  return appFrame({
    crumb: 'Memory',
    docTitle: 'Memory · MiniLab',
    labName: null,
    path: '/memory',
    error: extra?.error ?? null,
    notice: extra?.notice ?? null,
    theme: extra?.theme,
    extraCss: INDEX_CSS,
    body,
  });
}

/** Where a memory came from — meetings link to their page; other sources are text. */
function memorySourceLink(m: Memory): string {
  if (m.sourceType === 'meeting' && m.sourceId) {
    return `<a href="/meetings/${escapeHtml(m.sourceId)}">组会</a>`;
  }
  return `<code>${escapeHtml(m.sourceType)}</code>`;
}

// ---------------------------------------------------------------------------
// Task People View / Kanban (GET /projects/:projectId/tasks?view=people|kanban)
// ---------------------------------------------------------------------------

export interface TasksPageData {
  project: Project;
  labName: string;
  agents: Agent[];
  tasks: Task[];
  view: 'people' | 'kanban';
  theme?: string;
  error?: string | null;
  notice?: string | null;
}

export function renderTasksPage(data: TasksPageData): string {
  const { project } = data;
  const path = `/projects/${project.id}/tasks`;

  const switcher = `<div class="view-switch">
    <a class="pill${data.view === 'people' ? ' active' : ''}" href="/projects/${escapeHtml(project.id)}/tasks?view=people">👥 People</a>
    <a class="pill${data.view === 'kanban' ? ' active' : ''}" href="/projects/${escapeHtml(project.id)}/tasks?view=kanban">🗂 Kanban</a>
    <a class="pill" href="/projects/${escapeHtml(project.id)}">↩ 项目页</a>
  </div>`;

  const addTask = `<details>
    <summary>➕ 派发任务</summary>
    <form class="field" method="post" action="/ui/projects/${escapeHtml(project.id)}/tasks">
      <input type="hidden" name="_return" value="${escapeHtml(path)}?view=${escapeHtml(data.view)}" />
      <label>任务标题</label><input type="text" name="title" required maxlength="300" placeholder="例如：综述 Transformer 注意力机制对比" />
      <label>派给</label>
      <select name="assigneeAgentId" required>${data.agents.length === 0 ? '<option value="">（还没有成员，请先雇佣）</option>' : data.agents.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}</select>
      <label>优先级</label>
      <select name="priority"><option value="medium">中</option><option value="urgent">紧急</option><option value="high">高</option><option value="low">低</option></select>
      <div class="actions"><button class="btn" type="submit">创建任务</button></div>
    </form>
  </details>`;

  const body = `
    <section class="panel">
      <h2>${escapeHtml(project.title)} <span class="muted">· 任务视图</span></h2>
      <div>${switcher}</div>
      ${addTask}
    </section>
    ${data.view === 'people' ? renderPeopleView(data) : renderKanbanView(data)}
  `;

  return appFrame({
    crumb: `任务 · ${project.title}`,
    docTitle: `${project.title} · 任务 · MiniLab`,
    labName: data.labName,
    path,
    error: data.error ?? null,
    notice: data.notice ?? null,
    theme: data.theme,
    extraCss: INDEX_CSS,
    body,
  });
}

/** One per-status dropdown of allowed non-identity transitions (like the project page). */
function statusOptions(t: Task): string {
  return TASK_STATUS_TRANSITIONS[t.status]
    .filter((s) => s !== t.status)
    .map((s) => `<option value="${s}">${taskStatusLabel(s)}</option>`)
    .join('');
}

/** The `改状态` mini-form on each chip, returning to the same view. */
function chipStatusForm(t: Task, projectId: string, view: 'people' | 'kanban'): string {
  const next = TASK_STATUS_TRANSITIONS[t.status].filter((s) => s !== t.status);
  if (next.length === 0) return '';
  return `<form class="inline-form" method="post" action="/ui/tasks/${escapeHtml(t.id)}/status">
    <input type="hidden" name="_return" value="/projects/${escapeHtml(projectId)}/tasks?view=${escapeHtml(view)}" />
    <select name="status">${statusOptions(t)}</select>
    <button class="btn sm ghost" type="submit">改</button>
  </form>`;
}

function taskChip(t: Task, projectId: string, view: 'people' | 'kanban'): string {
  return `<li class="task-chip">
    <span class="badge status-${escapeHtml(t.status)}">${taskStatusLabel(t.status)}</span>
    <a href="/projects/${escapeHtml(projectId)}#task-${escapeHtml(t.id)}">${escapeHtml(t.title)}</a>
    ${chipStatusForm(t, projectId, view)}
  </li>`;
}

function renderPeopleView(data: TasksPageData): string {
  const { project, tasks, agents, view } = data;
  const assigned = agents.filter((a) => tasks.some((t) => t.assigneeAgentId === a.id));
  const idle = agents.filter((a) => !assigned.includes(a));

  const cards = assigned
    .map((a) => {
      const mine = tasks.filter((t) => t.assigneeAgentId === a.id);
      const bucket = (title: string, statuses: readonly Task['status'][], fallbackEmpty: boolean): string => {
        const chips = mine.filter((t) => statuses.includes(t.status));
        if (chips.length === 0 && !fallbackEmpty) return '';
        return `<div class="bucket"><div class="bucket-title">${title}</div>
          <ul class="bucket-tasks">${chips.length === 0 ? '<li class="muted" style="font-size:0.82rem">—</li>' : chips.map((t) => taskChip(t, project.id, view)).join('')}</ul>
        </div>`;
      };
      return `<div class="person-group">
        <h3><a href="/agents/${escapeHtml(a.id)}">${escapeHtml(a.name)}</a>
          <span class="muted">· ${escapeHtml(a.role)}${a.specialization ? ` · ${escapeHtml(a.specialization)}` : ''}</span>
        </h3>
        ${bucket('✅ Done', ['completed'], true)}
        ${bucket('🚀 Doing', ['running'], true)}
        ${bucket('⏭ Next', ['ready', 'backlog'], true)}
        ${bucket('⏳ 等待 PI', ['review'], true)}
        ${bucket('⛔ Blocked', ['blocked'], true)}
      </div>`;
    })
    .join('');

  const idleLine = idle.length === 0
    ? ''
    : `<p class="muted">空闲成员（本项目中无任务）：${idle.map((a) => escapeHtml(a.name)).join('、')}</p>`;

  return `
    <section class="panel">
      <h2>👥 谁在干什么 <span class="muted">（按人 × 当前状态）</span></h2>
      ${assigned.length === 0 ? '<p class="muted">还没有人接过这里的任务。用上面的「派发任务」开始。</p>' : cards}
      ${idleLine}
    </section>`;
}

function renderKanbanView(data: TasksPageData): string {
  const { project, tasks, view } = data;
  const statuses: readonly Task['status'][] = ['backlog', 'ready', 'running', 'review', 'blocked', 'completed', 'cancelled'];
  const cols = statuses
    .map((s) => {
      const chips = tasks.filter((t) => t.status === s);
      return `<div class="kanban-col">
        <h3>${taskStatusLabel(s)} <span class="muted">(${chips.length})</span></h3>
        ${chips.length === 0
          ? '<p class="muted" style="font-size:0.85rem">—</p>'
          : `<ul class="bucket-tasks">${chips.map((t) => taskChip(t, project.id, view)).join('')}</ul>`}
      </div>`;
    })
    .join('');

  return `
    <section class="panel">
      <h2>🗂 看板 <span class="muted">（按状态列）</span></h2>
      <div class="kanban-cols">${cols}</div>
    </section>
    <section class="panel">
      <h2>ℹ 状态流转</h2>
      <ul class="muted" style="font-size:0.88rem">
        <li>待办池 → To Do → Doing → ⏳ 等待 PI → 完成</li>
        <li>阻塞 随时可以拉回 Doing，或取消（→ 已取消）。</li>
      </ul>
    </section>`;
}

