import type { Agent } from '../domain/agent';
import type { AgentRun } from '../domain/agentRun';
import type { Artifact } from '../domain/artifact';
import type { Meeting } from '../domain/meeting';
import type { MeetingDetail } from '../application/meetingService';
import type { Memory } from '../domain/memory';
import type { Project } from '../domain/project';
import type { Task } from '../domain/task';
import { TASK_STATUS_TRANSITIONS } from '../domain/task';
import {
  escapeHtml,
  stageLabel,
  statusLabel,
  taskStatusLabel,
  priorityLabel,
  appFrame,
} from './uiTheme';

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
  /** Request path — picks the active sidebar entry (shared app frame). */
  path: string;
  error?: string | null;
  notice?: string | null;
  /** Preferred theme (light|dark|system) from the user's personalization prefs. */
  theme?: string;
  body: string;
}

export function pageShell(o: PageOptions): string {
  return appFrame({
    crumb: o.title,
    docTitle: `${o.title} · MiniLab`,
    labName: o.labName,
    path: o.path,
    error: o.error ?? null,
    notice: o.notice ?? null,
    theme: o.theme,
    body: o.body,
  });
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
  path: string;
  error?: string | null;
  notice?: string | null;
  theme?: string;
}

const TERMINAL_TASK_STATUSES: readonly string[] = ['completed', 'cancelled'];

export function renderProjectPage(data: ProjectPageData): string {
  const { project, lab } = data;

  const taskRows = data.tasks
    .map((t) => {
      const nextOptions = TASK_STATUS_TRANSITIONS[t.status]
        .filter((s) => s !== t.status)
        .map((s) => `<option value="${s}">${taskStatusLabel(s)}</option>`)
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
        <td><span class="badge status-${escapeHtml(t.status)}">${taskStatusLabel(t.status)}</span></td>
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
    path: data.path,
    error: data.error ?? null,
    notice: data.notice ?? null,
    theme: data.theme,
    body,
  });
}

// ---------------------------------------------------------------------------
// Meeting page
// ---------------------------------------------------------------------------

export interface MeetingPageData {
  detail: MeetingDetail;
  lab: { id: string; name: string };
  path: string;
  error?: string | null;
  notice?: string | null;
  theme?: string;
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
    path: data.path,
    error: data.error ?? null,
    notice: data.notice ?? null,
    theme: data.theme,
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
  path: string;
  error?: string | null;
  notice?: string | null;
  theme?: string;
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
        <span class="badge status-${escapeHtml(t.status)}">${taskStatusLabel(t.status)}</span>
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
    path: data.path,
    error: data.error ?? null,
    notice: data.notice ?? null,
    theme: data.theme,
    body,
  });
}
