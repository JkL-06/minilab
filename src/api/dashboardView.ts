import type { LabDashboard } from '../application/dashboardService';
import {
  escapeHtml,
  stageLabel,
  statusLabel,
  taskStatusLabel,
  priorityLabel,
  appFrame,
} from './uiTheme';

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
 *
 * Styling is shared with the detail pages via `uiTheme` (brand header, favicon,
 * design-system CSS), so the whole product surface stays visually consistent.
 */

// Re-exported so existing importers (uiView, uiRoutes) keep working.
export { escapeHtml, stageLabel, statusLabel, taskStatusLabel, priorityLabel } from './uiTheme';

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
  extra?: {
    modelConfigs?: DashboardModelConfig[];
    error?: string | null;
    notice?: string | null;
    theme?: string;
    /** Whether the settings 语音 tab has voice enabled (dashboard buttons). */
    voiceEnabled?: boolean;
  },
): string {
  const { lab } = dashboard;
  const modelConfigs = extra?.modelConfigs ?? [];
  const error = extra?.error ?? null;
  const notice = extra?.notice ?? null;
  const voiceEnabled = extra?.voiceEnabled ?? true;

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
                  <span class="badge status-${escapeHtml(t.status)}">${taskStatusLabel(t.status)}</span>
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
              <span class="badge status-${escapeHtml(t.status)}">${taskStatusLabel(t.status)}</span>
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

  // KPI cards — a glanceable read of the Lab's current state (no LLM call).
  const statCards = [
    { label: '成员', num: dashboard.agents.length, extra: '持久身份' },
    { label: '进行中项目', num: dashboard.projects.length, extra: 'projects' },
    { label: '需要关注', num: dashboard.attentionTasks.length, extra: '任务' },
    { label: '模型配置', num: modelConfigs.length, extra: 'configs' },
  ]
    .map(
      (s) => `<div class="stat-card"><div class="stat-num">${s.num}</div><div class="stat-label">${s.label}</div><div class="stat-extra">${s.extra}</div></div>`,
    )
    .join('');

  // 语音面板（🎤 录音转写 / 🔊 文字朗读）。这是全站唯一的内联 JS —— 服务端纯
  // SSR 架构下，麦克风采集只能靠浏览器 API，故最小侵入地内联一个小脚本。语音由
  // DashScope 提供，密钥在服务端复用「配置」分区的模型配置，浏览器不接触 key。
  const voicePanel = voiceEnabled
    ? `<section class="panel" id="voice-panel">
    <h2>🎤 语音助手</h2>
    <p class="muted">录制语音转文字（ASR），或输入文字朗读（TTS）。语音密钥复用「配置」分区的 DashScope 模型；在 设置 → 语音 可关闭本面板。</p>
    <form class="field" onsubmit="return false;">
      <label for="voiceText">文字</label>
      <textarea id="voiceText" maxlength="5000" placeholder="输入要朗读的文字；点击「开始录音」后，识别结果会自动填入此处…"></textarea>
      <div class="actions voice-actions">
        <button class="btn" type="button" onclick="MiniLabVoice.speak()">🔊 朗读</button>
        <button class="btn" type="button" id="voiceRecord" onclick="MiniLabVoice.toggle()">🎤 开始录音</button>
        <span class="voice-status muted" id="voiceStatus"></span>
      </div>
      <audio id="voiceAudio" controls preload="none" style="display:none"></audio>
    </form>
  </section>`
    : '';

  const voiceScript = voiceEnabled
    ? `<script>
(function () {
  var LAB_ID = ${JSON.stringify(lab.id)};
  var $ = function (id) { return document.getElementById(id); };
  var setStatus = function (msg, err) {
    var el = $('voiceStatus');
    el.textContent = msg;
    el.className = 'voice-status' + (err ? ' voice-err' : ' muted');
  };
  var mediaRec = null;
  var chunks = [];

  function speak() {
    var text = $('voiceText').value.trim();
    if (!text) { setStatus('先输入或录一段文字'); return; }
    setStatus('正在合成语音…');
    fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labId: LAB_ID, text: text })
    }).then(function (res) {
      if (!res.ok) { return res.json().catch(function () { return {}; }).then(function (e) { throw new Error(e.error && e.error.message || '合成失败'); }); }
      return res.blob();
    }).then(function (blob) {
      var audio = $('voiceAudio');
      audio.src = URL.createObjectURL(blob);
      audio.style.display = 'block';
      audio.play().catch(function () {});
      setStatus('朗读完成');
    }).catch(function (err) { setStatus(err.message, true); });
  }

  function stopRecording() {
    if (!mediaRec) return;
    mediaRec.stop();
    mediaRec = null;
    $('voiceRecord').textContent = '🎤 开始录音';
  }

  function toggle() {
    if (mediaRec) { stopRecording(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('当前环境不支持麦克风', true);
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      chunks = [];
      mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(chunks, { type: mediaRec.mimeType || 'audio/webm' });
        setStatus('正在识别…');
        fetch('/api/voice/asr?labId=' + encodeURIComponent(LAB_ID), {
          method: 'POST',
          headers: { 'Content-Type': blob.type },
          body: blob
        }).then(function (res) {
          if (!res.ok) { return res.json().catch(function () { return {}; }).then(function (e) { throw new Error(e.error && e.error.message || '识别失败'); }); }
          return res.json();
        }).then(function (data) {
          if (data.text) $('voiceText').value = data.text;
          setStatus('识别完成，已填入文本框');
        }).catch(function (err) { setStatus(err.message, true); });
      };
      mediaRec.start();
      $('voiceRecord').textContent = '⏹ 停止录音';
      setStatus('正在录音…');
    }).catch(function (err) {
      setStatus('无法访问麦克风：' + (err && err.message || err), true);
    });
  }

  window.MiniLabVoice = { speak: speak, toggle: toggle };
})();
<\/script>`
    : '';

  const voiceCss = `
  .voice-actions { align-items: center; }
  .voice-status { font-size: 0.85rem; }
  .voice-status.voice-err { color: var(--danger); }
  #voiceAudio { width: 100%; margin-top: 0.6rem; }
`;

  const body = `
    <div class="hero">
      <h1>🏛 ${escapeHtml(lab.name)}</h1>
      <p>PI Dashboard —— 打开即是实验室当前状态，无需任何输入（SPEC-010）</p>
    </div>

    <div class="stats">${statCards}</div>

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

    ${voicePanel}

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
  `;

  return appFrame({
    crumb: 'PI Dashboard',
    docTitle: `${lab.name} · PI Dashboard`,
    labName: lab.name,
    path: `/labs/${lab.id}/dashboard`,
    error,
    notice,
    theme: extra?.theme,
    extraCss: voiceCss,
    extraBody: voiceScript,
    body,
    tagline: `本页由持久化领域状态确定性生成（不经过任何模型调用）· ${lab.name}`,
  });
}
