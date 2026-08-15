import type { LabDashboard } from '../application/dashboardService';

/**
 * SPEC-010 UI layer (ADR-0006 #3): renders the LabDashboard as a server-side
 * HTML page. A pure function — the route calls it with the canonical dashboard
 * object, so the page can never read state the service hasn't already derived
 * (rule 19: UI stays outside the domain).
 *
 * Every user-authored string is HTML-escaped (XSS safety). The page is the
 * "default UI": it opens on the Lab's state, not on an empty prompt (acceptance
 * #1), and renders each Agent as a persistent identity card — never as a chat
 * message — which is what makes an Agent visually distinct from a temporary chat
 * participant (acceptance #4).
 */

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

export interface DashboardModelConfig {
  id: string;
  name: string;
  model: string;
  provider: string;
  baseUrl: string | null;
  apiKeyConfigured: boolean;
}

export function renderDashboardPage(
  dashboard: LabDashboard,
  extra?: { modelConfigs?: DashboardModelConfig[]; error?: string | null; notice?: string | null },
): string {
  const { lab } = dashboard;
  const modelConfigs = extra?.modelConfigs ?? [];
  const error = extra?.error ?? null;
  const notice = extra?.notice ?? null;

  const projectRows = dashboard.projects
    .map(
      (p) => `<tr>
        <td><a href="/projects/${escapeHtml(p.id)}">${escapeHtml(p.title)}</a></td>
        <td>${stageLabel(p.stage)}</td>
        <td><span class="badge status-${escapeHtml(p.status)}">${statusLabel(p.status)}</span></td>
        <td>${escapeHtml(p.updatedAt.slice(0, 19).replace('T', ' '))}</td>
      </tr>`,
    )
    .join('');

  const agentCards = dashboard.agents
    .map((agent) => {
      const taskList =
        agent.currentTasks.length === 0
          ? '<li class="empty">暂无进行中任务</li>'
          : agent.currentTasks
              .map(
                (t) => `<li>
                  <span class="badge status-${escapeHtml(t.status)}">${statusLabel(t.status)}</span>
                  ${escapeHtml(t.title)}
                  <span class="muted">· ${escapeHtml(t.projectTitle)}</span>
                </li>`,
              )
              .join('');
      return `<article class="agent-card" data-agent-id="${escapeHtml(agent.id)}">
        <div class="agent-avatar" aria-hidden="true">${escapeHtml(agent.name.charAt(0))}</div>
        <div class="agent-body">
          <div class="agent-name">
            <a href="/agents/${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</a>
            <span class="badge status-${escapeHtml(agent.status)}">${statusLabel(agent.status)}</span>
          </div>
          <div class="muted">${escapeHtml(agent.role)}${agent.specialization ? ` · ${escapeHtml(agent.specialization)}` : ''} · 持久实验室成员（非临时对话参与者）</div>
          <ul class="agent-tasks">${taskList}</ul>
        </div>
      </article>`;
    })
    .join('');

  const attentionList =
    dashboard.attentionTasks.length === 0
      ? '<li class="empty">没有需要关注的任务 ✅</li>'
      : dashboard.attentionTasks
          .map(
            (t) => `<li>
              <span class="badge status-${escapeHtml(t.status)}">${statusLabel(t.status)}</span>
              <strong>${escapeHtml(t.title)}</strong>
              <span class="muted">· ${escapeHtml(t.projectTitle)} · 指派给 ${escapeHtml(t.assigneeName)} · ${priorityLabel(t.priority)}优先级</span>
            </li>`,
          )
          .join('');

  const questionList =
    dashboard.questionsForPi.length === 0
      ? '<li class="empty">没有等待你的问题 ✅</li>'
      : dashboard.questionsForPi
          .map(
            (q) => `<li>
              <strong>${escapeHtml(q.question)}</strong>
              <span class="muted">· ${escapeHtml(q.agentName)} 就「${escapeHtml(q.taskTitle)}」提出</span>
            </li>`,
          )
          .join('');

  const artifactList =
    dashboard.recentArtifacts.length === 0
      ? '<li class="empty">暂无产物</li>'
      : dashboard.recentArtifacts
          .map(
            (a) => `<li>
              <strong>${escapeHtml(a.title)}</strong>
              <span class="muted">· ${escapeHtml(a.type)} v${escapeHtml(a.version)} · ${escapeHtml(a.projectTitle)}</span>
            </li>`,
          )
          .join('');

  const decisionList =
    dashboard.recentDecisions.length === 0
      ? '<li class="empty">暂无决策</li>'
      : dashboard.recentDecisions
          .map(
            (d) => `<li>
              <strong>${escapeHtml(d.statement)}</strong>
              ${d.rationale ? `<span class="muted">· ${escapeHtml(d.rationale)}</span>` : ''}
            </li>`,
          )
          .join('');

  const meetingList =
    dashboard.meetings.length === 0
      ? '<li class="empty">暂无组会</li>'
      : dashboard.meetings
          .map(
            (m) => `<li>
              <span class="badge status-${escapeHtml(m.status)}">${statusLabel(m.status)}</span>
              <strong>${escapeHtml(m.title)}</strong>
              <span class="muted">· ${escapeHtml(m.projectTitle)}</span>
              <a class="meeting-link" href="/meetings/${escapeHtml(m.id)}">查看</a>
            </li>`,
          )
          .join('');

  const modelConfigOptions =
    modelConfigs.length === 0
      ? '<option value="">（还没有模型配置，请先连接模型）</option>'
      : modelConfigs
          .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}（${escapeHtml(c.model)}）</option>`)
          .join('');
  const modelConfigList = modelConfigs
    .map(
      (c) => `<li><strong>${escapeHtml(c.name)}</strong><span class="muted"> · ${escapeHtml(c.provider)} · ${escapeHtml(c.model)}${c.baseUrl ? ` · ${escapeHtml(c.baseUrl)}` : ''}${c.apiKeyConfigured ? ' · 已配 Key' : ' · 未配 Key'}</span></li>`,
    )
    .join('');

  const onboardingWarning =
    dashboard.agents.length > 0 && modelConfigs.length === 0
      ? '<p class="flash error">⚠ 成员还没有可用的模型配置 —— 先连接一个模型（用 mock 可零成本试玩），再指派给成员，否则任务无法执行。</p>'
      : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(lab.name)} · PI Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    line-height: 1.5;
    background: #f4f6f9;
    color: #1c2333;
  }
  header.top { background: #0f1b2d; color: #fff; padding: 1.25rem 1.5rem; }
  header.top h1 { margin: 0; font-size: 1.3rem; }
  header.top p { margin: 0.3rem 0 0; opacity: 0.75; font-size: 0.9rem; }
  main { max-width: 1080px; margin: 0 auto; padding: 1.25rem 1.5rem 3rem; }
  section.panel {
    background: #fff;
    border: 1px solid #e2e6ee;
    border-radius: 10px;
    padding: 1rem 1.25rem;
    margin: 1rem 0;
  }
  section.panel h2 { margin: 0 0 0.75rem; font-size: 1.05rem; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 0.4rem 0; border-bottom: 1px solid #eef1f6; }
  li:last-child { border-bottom: none; }
  li.empty { color: #6b7a90; font-style: italic; }
  .muted { color: #6b7a90; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid #eef1f6; }
  th { color: #6b7a90; font-weight: 600; font-size: 0.85rem; }
  .badge {
    display: inline-block;
    padding: 0.08rem 0.5rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-right: 0.35rem;
  }
  .status-blocked, .status-review, .status-running { background: #fdecea; color: #b3261e; }
  .status-active, .status-in_progress, .status-ready { background: #e7f3ff; color: #0b5cad; }
  .status-completed, .status-scheduled, .status-succeeded { background: #e6f6ec; color: #1a7f45; }
  .status-planned, .status-backlog { background: #eef1f6; color: #5a6a80; }
  .status-paused, .status-cancelled, .status-inactive, .status-archived { background: #eef1f6; color: #7a7f87; }
  .agent-card {
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    border: 1px solid #dbe2ec;
    border-left: 4px solid #0b5cad;
    border-radius: 10px;
    padding: 0.8rem 1rem;
    margin: 0.6rem 0;
  }
  .agent-avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: #0b5cad; color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1.1rem; flex: none;
  }
  .agent-name { font-weight: 700; }
  .agent-tasks { margin-top: 0.4rem; }
  .agent-tasks li { border: none; padding: 0.15rem 0; }
  .meeting-link { margin-left: 0.5rem; color: #0b5cad; text-decoration: none; font-size: 0.85rem; }
  footer { text-align: center; color: #8a94a6; font-size: 0.8rem; margin-top: 2rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #131a26; color: #e6eaf2; }
    section.panel { background: #1b2436; border-color: #2a3550; }
    li, th, td { border-color: #2a3550; }
    .agent-card { border-color: #2a3550; }
    .muted, th { color: #8a94a6; }
    .status-planned, .status-backlog, .status-paused, .status-cancelled, .status-inactive, .status-archived { background: #2a3550; color: #b7c1d4; }
  }
</style>
</head>
<body>
<header class="top">
  <h1>🏛 ${escapeHtml(lab.name)}</h1>
  <p>PI Dashboard —— 打开即是实验室当前状态，无需任何输入（SPEC-010）</p>
</header>
<main>
  ${error ? `<div class="flash error">⚠ ${escapeHtml(error)}</div>` : ''}
  ${notice ? `<div class="flash ok">✓ ${escapeHtml(notice)}</div>` : ''}
  ${onboardingWarning}

  <section class="panel">
    <h2>⚡ 快速操作</h2>
    <details>
      <summary>🤖 雇佣成员</summary>
      <form class="field" method="post" action="/ui/labs/${escapeHtml(lab.id)}/agents">
        <input type="hidden" name="_return" value="/labs/${escapeHtml(lab.id)}/dashboard" />
        <label>姓名</label><input type="text" name="name" required maxlength="200" placeholder="例如：Alice" />
        <label>角色</label><input type="text" name="role" maxlength="100" placeholder="例如：researcher（默认）" />
        <label>专长</label><textarea name="specialization" maxlength="2000" placeholder="（可选）例如：NLP、因果推断…"></textarea>
        <label>模型</label>
        <select name="modelConfigId">${modelConfigOptions}</select>
        <div class="actions"><button class="btn" type="submit">雇佣</button></div>
      </form>
    </details>
    <details>
      <summary>🔌 连接模型</summary>
      <form class="field" method="post" action="/ui/labs/${escapeHtml(lab.id)}/model-configs">
        <input type="hidden" name="_return" value="/labs/${escapeHtml(lab.id)}/dashboard" />
        <label>配置名称</label><input type="text" name="name" required maxlength="100" placeholder="例如：OpenAI GPT-4o" />
        <label>提供商</label>
        <select name="provider">
          <option value="openai_compatible">openai_compatible（OpenAI / Ollama / vLLM / DeepSeek 等）</option>
          <option value="mock">mock（本地演示，无需网络）</option>
        </select>
        <label>模型</label><input type="text" name="model" required maxlength="200" placeholder="例如：gpt-4o-mini" />
        <label>Base URL</label><input type="url" name="baseUrl" maxlength="500" placeholder="（可选）默认 https://api.openai.com/v1" />
        <label>API Key</label><input type="password" name="apiKey" maxlength="2000" placeholder="（可选）加密存储，仅用于调用模型" />
        <div class="actions"><button class="btn" type="submit">保存配置</button></div>
      </form>
    </details>
  </section>

  <section class="panel">
    <h2>🔌 模型配置（${modelConfigs.length}）</h2>
    ${modelConfigs.length === 0 ? '<p class="muted">还没连接模型。用上面的「连接模型」添加一个；用 mock 即可零成本试玩全流程。</p>' : `<ul>${modelConfigList}</ul>`}
  </section>

  <section class="panel">
    <h2>📁 进行中的项目（${dashboard.projects.length}）</h2>
    ${dashboard.projects.length === 0 ? '<p class="muted">暂无进行中的项目。</p>' : `<table>
      <thead><tr><th>项目</th><th>阶段</th><th>状态</th><th>更新于</th></tr></thead>
      <tbody>${projectRows}</tbody>
    </table>`}
  </section>

  <section class="panel">
    <h2>🤖 成员（${dashboard.agents.length}）—— 持久身份，非临时对话参与者</h2>
    ${dashboard.agents.length === 0 ? '<p class="muted">还没有成员。用 POST /labs/:labId/agents 雇佣第一位 Agent。</p>' : agentCards}
  </section>

  <section class="panel">
    <h2>⚠️ 需要关注的任务（${dashboard.attentionTasks.length}）</h2>
    <ul>${attentionList}</ul>
  </section>

  <section class="panel">
    <h2>❓ 等待你的问题（${dashboard.questionsForPi.length}）</h2>
    <ul>${questionList}</ul>
  </section>

  <section class="panel">
    <h2>📦 最近产物（${dashboard.recentArtifacts.length}）</h2>
    <ul>${artifactList}</ul>
  </section>

  <section class="panel">
    <h2>🧭 最近决策（${dashboard.recentDecisions.length}）</h2>
    <ul>${decisionList}</ul>
  </section>

  <section class="panel">
    <h2>🗓 组会入口（${dashboard.meetings.length}）</h2>
    <ul>${meetingList}</ul>
  </section>

  <footer>
    本页由持久化领域状态确定性生成（不经过任何模型调用）· ${escapeHtml(lab.name)} · MiniLab SPEC-010
  </footer>
</main>
</body>
</html>`;
}
