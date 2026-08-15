/**
 * MiniLab SPEC-001/002/003/004/005/006/007/008/009 端到端演示
 *
 * 自动启动一个真实的 API 服务进程（临时数据库），逐条演练所有接口与
 * 验收标准，包括「进程重启后数据仍可取回」，最后清理并退出。
 * SPEC-005 部分使用 mock 提供商与一个必然不可达的本地端口演示网关与
 * 归一化错误分类；SPEC-006 部分使用 schema 感知的 mock 演示 Agent 执行
 * 一次有界任务，并用一个本地「原始文本」桩演示 schema 失败、
 * 用不可达端口演示供应商失败；SPEC-007 部分演示持久化作用域记忆的
 * 写入、检索、授权过滤，并用一个「记忆回显」桩把系统提示里的记忆行
 * 原样带回结构化结果，证明记忆确实进入了 Agent 的提示词；SPEC-008
 * 部分演示成功运行把产物提案实体化为持久 Artifact（关联 Project、
 * 保留版本元数据、跨 Lab 不可见），并验证重启后仍可取回；SPEC-009
 * 部分演示一次「组会」：Alice/Bob 的结构化进展基于其当前任务/产物
 * 自动生成，PI 记录决策、行动项生成后续任务、完成时写入 Project/Lab
 * 记忆，完成态是结构化记录而非仅仅转录，并验证重启后仍可取回；SPEC-010
 * 部分演示 PI 仪表盘（默认 UI）：打开 GET / 即是第一个 Lab 的仪表盘，
 * 一个受阻任务与一条等待 PI 的问题在默认 HTML 页与同源 JSON 接口里都可见，
 * 成员以持久身份卡片渲染，读取仪表盘不产生任何模型调用（确定性读模型），
 * 并验证重启后同一状态仍可取回。全程无需外网、无需真实 API 密钥。
 *
 * 用法：npm run demo
 * 失败时会以非零退出码结束。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = join(ROOT, 'dist', 'src', 'server.js');
const DB_PATH = join(mkdtempSync(join(tmpdir(), 'minilab-demo-')), 'demo.db');
const PORT = 3000 + Math.floor(Math.random() * 2000);

let failures = 0;
let serverChild = null;
let rawServer = null;
let echoServer = null;
let blockedServer = null;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} —— 实际 ${actual}，期望 ${expected}`);
}

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB_PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`服务未能启动。输出：\n${out}`)),
      8000,
    );
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('listening')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务提前退出（code=${code}）。输出：\n${out}`));
    });
  });
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 1000);
  });
}

async function req(method, path, { user, body, accept } = {}) {
  const headers = {};
  if (user) headers['X-User-Id'] = user;
  if (accept) headers['Accept'] = accept;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers,
    redirect: 'manual', // 不跟随重定向：SPEC-010 需要断言 GET / 的 302 Location
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应（如仪表盘的 HTML 页） */
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

/**
 * 返回一个「保证不可达」的本地端口 URL：先占用一个临时端口、立刻释放，
 * 再让网关去连它——必然连接失败，得到 connection_failed，而不会打外网。
 * 用这个做供应商失败的确定性演示。
 */
function closedPortUrl() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(`http://127.0.0.1:${port}/v1`));
    });
  });
}

/**
 * 启动一个本地 OpenAI 兼容桩：它返回「合法的 chat-completions JSON，
 * 但 content 是一段普通文本」——适配器能成功解析，于是网关返回了未经
 * 结构化的原始文本，进入 SPEC-006 的 schema 校验并被拒绝（retryable）。
 * 用这个确定性演示「原始文本永远不能改变任务状态」。
 */
function rawTextServer() {
  return new Promise((resolve) => {
    const srv = createHttpServer((req, res) => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [
                { message: { content: 'Sure, I will take care of it.' }, finish_reason: 'stop' },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 4 },
            }),
          );
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => srv.close() });
    });
  });
}

/**
 * 启动一个本地 OpenAI 兼容桩：它返回一个「合法结构化但任务被阻塞」的结果
 * （task_status=blocked + 一条等待 PI 的问题 + 一条产物提案）。运行成功后
 * 任务进入 blocked、问题出现在仪表盘的「等待你的问题」、产物被实体化。
 * 用这个确定性制造 PI 仪表盘（SPEC-010）要展示的「需要 PI 关注」状态。
 */
function blockedStubServer() {
  return new Promise((resolve) => {
    const srv = createHttpServer((req, res) => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: '证据检索受阻：需要 PI 决定优先级。',
                      task_status: 'blocked',
                      artifact_proposals: [
                        { title: '优先级建议表', content: '建议优先处理 2024 年后的元分析。', type: 'table' },
                      ],
                      findings: [],
                      questions_for_pi: [{ question: '是否优先整合 2024 年后的元分析？' }],
                      suggested_tasks: [],
                      memory_candidates: [],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 6 },
            }),
          );
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => srv.close() });
    });
  });
}

/**
 * 启动一个本地 OpenAI 兼容桩：它把请求里系统提示中「Authorized memory:」
 * 下方的记忆行（以 `- [` 开头）全部抄进一个合法结构化结果的 summary 里
 * 返回。运行成功后，result.summary 会包含这些记忆行，从而确定性证明
 * 「记忆确实进入了 Agent 的提示词」（SPEC-007 验收 #1/#2/#3/#5）。
 */
function memoryEchoServer() {
  return new Promise((resolve) => {
    const srv = createHttpServer((req, res) => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let messages = [];
          try {
            messages = JSON.parse(body).messages ?? [];
          } catch {
            messages = [];
          }
          const system =
            messages.find((m) => m.role === 'system')?.content ?? '';
          const memoryLines = system
            .split('\n')
            .filter((line) => /^\s*-\s*\[/.test(line));
          const summary = memoryLines.length
            ? `已注入 ${memoryLines.length} 条记忆：${memoryLines.join(' | ')}`
            : '未检测到记忆行';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary,
                      task_status: 'completed',
                      artifact_proposals: [],
                      findings: [],
                      questions_for_pi: [],
                      suggested_tasks: [],
                      memory_candidates: [],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 12, completion_tokens: 5 },
            }),
          );
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => srv.close() });
    });
  });
}

try {
  console.log('MiniLab SPEC-001/002/003/004/005/006/007/008/009/010 端到端演示');
  console.log(`临时数据库：${DB_PATH}\n`);

  // ---- 第一次启动 ----
  section('第一次启动服务');
  serverChild = await startServer();
  console.log(`  API 已就绪：http://127.0.0.1:${PORT}`);

  // ---- 创建 Lab（验收标准 1）----
  section('POST /labs 创建 Lab');
  const created = await req('POST', '/labs', {
    user: 'user-1',
    body: { name: '认知科学实验室', description: '研究记忆与决策' },
  });
  check('创建返回 201', created.status, 201);
  check('返回了持久 Lab ID', typeof created.body?.lab?.id === 'string', true);
  const labId = created.body.lab.id;
  console.log(`  Lab：${JSON.stringify(created.body.lab, null, 2)}`);

  // ---- 空名校验（验收标准 4）----
  section('校验：拒绝空名称');
  const empty = await req('POST', '/labs', { user: 'user-1', body: { name: '' } });
  check('空名返回 400', empty.status, 400);
  check('错误码为 VALIDATION_ERROR', empty.body?.error?.code, 'VALIDATION_ERROR');

  // ---- 认证（验收标准 3 前置）----
  section('认证：缺少用户身份');
  const noAuth = await req('POST', '/labs', { body: { name: 'x' } });
  check('未认证返回 401', noAuth.status, 401);
  check('错误码为 UNAUTHENTICATED', noAuth.body?.error?.code, 'UNAUTHENTICATED');

  // ---- 所有权（验收标准 3）----
  section('所有权：其他用户不可读写');
  const otherGet = await req('GET', `/labs/${labId}`, { user: 'user-2' });
  check('他人读取返回 403', otherGet.status, 403);
  const otherPatch = await req('PATCH', `/labs/${labId}`, {
    user: 'user-2',
    body: { name: '劫持' },
  });
  check('他人修改返回 403', otherPatch.status, 403);

  // ---- 查询 ----
  section('GET /labs 列表');
  const list = await req('GET', '/labs', { user: 'user-1' });
  check('列表返回 200', list.status, 200);
  check('列表中包含刚创建的 Lab', list.body.labs.some((l) => l.id === labId), true);

  // ---- 更新 ----
  section('PATCH /labs/:labId 更新');
  const patched = await req('PATCH', `/labs/${labId}`, {
    user: 'user-1',
    body: { name: '认知科学实验室（更新）', description: '聚焦工作记忆' },
  });
  check('更新返回 200', patched.status, 200);
  check('名称已更新', patched.body?.lab?.name, '认知科学实验室（更新）');

  // ---- 404 ----
  section('GET /labs/:labId 未知 ID');
  const missing = await req('GET', '/labs/does-not-exist', { user: 'user-1' });
  check('未知 ID 返回 404', missing.status, 404);
  check('错误码为 NOT_FOUND', missing.body?.error?.code, 'NOT_FOUND');

  // ---- Agent：雇佣 Alice（SPEC-002）----
  section('POST /labs/:labId/agents 雇佣 Alice');
  const hired = await req('POST', `/labs/${labId}/agents`, {
    user: 'user-1',
    body: { name: 'Alice', role: 'phd_researcher', specialization: '工作记忆' },
  });
  check('雇佣返回 201', hired.status, 201);
  check('返回持久 agent_id', typeof hired.body?.agent?.id === 'string', true);
  check('Alice 归属唯一 Lab', hired.body?.agent?.labId, labId);
  const agentId = hired.body.agent.id;
  console.log(`  Agent：${JSON.stringify(hired.body.agent, null, 2)}`);

  // ---- Agent：密钥不进行（SPEC-002 #5）----
  section('SPEC-002 #5：模型密钥不进 Agent 行');
  const secretTry = await req('POST', `/labs/${labId}/agents`, {
    user: 'user-1',
    body: { name: 'Mallory', api_key: 'sk-topsecret' },
  });
  check('携带 api_key 被拒绝（400）', secretTry.status, 400);
  check('错误码为 VALIDATION_ERROR', secretTry.body?.error?.code, 'VALIDATION_ERROR');

  // ---- Agent：查询与更新 ----
  section('GET /labs/:labId/agents 与 GET/PATCH /agents/:agentId');
  const agentList = await req('GET', `/labs/${labId}/agents`, { user: 'user-1' });
  check('实验室成员列表 200', agentList.status, 200);
  check('列表包含 Alice', agentList.body.agents.some((a) => a.id === agentId), true);

  const agentGet = await req('GET', `/agents/${agentId}`, { user: 'user-1' });
  check('按 ID 查询 200', agentGet.status, 200);
  check('名称为 Alice', agentGet.body?.agent?.name, 'Alice');

  const deactivated = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { status: 'inactive', profile: '研究记忆与决策' },
  });
  check('停用返回 200', deactivated.status, 200);
  check('状态为 inactive（记录保留）', deactivated.body?.agent?.status, 'inactive');

  // ---- 跨 Lab 拒绝（SPEC-002 #4）----
  section('SPEC-002 #4：跨 Lab 访问被拒绝');
  const crossAgent = await req('GET', `/agents/${agentId}`, { user: 'user-2' });
  check('他人读取 Agent 返回 403', crossAgent.status, 403);
  check('错误码为 FORBIDDEN', crossAgent.body?.error?.code, 'FORBIDDEN');

  // ---- Project：创建（SPEC-003 #1）----
  section('POST /labs/:labId/projects 创建 Project');
  const createdProj = await req('POST', `/labs/${labId}/projects`, {
    user: 'user-1',
    body: { title: '工作记忆机制研究', objective: '梳理工作记忆的神经机制证据', stage: 'survey' },
  });
  check('创建返回 201', createdProj.status, 201);
  check('返回持久 project id', typeof createdProj.body?.project?.id === 'string', true);
  check('Project 归属唯一 Lab', createdProj.body?.project?.labId, labId);
  check('stage 合法（survey）', createdProj.body?.project?.stage, 'survey');
  const projectId = createdProj.body.project.id;
  console.log(`  Project：${JSON.stringify(createdProj.body.project, null, 2)}`);

  // ---- Project：stage 必须是受支持的 ResearchStage（SPEC-003 #2）----
  section('SPEC-003 #2：stage 必须是受支持的 ResearchStage');
  const badStage = await req('POST', `/labs/${labId}/projects`, {
    user: 'user-1',
    body: { title: '非法阶段', stage: 'brainstorm' },
  });
  check('不支持的 stage 返回 400', badStage.status, 400);
  check('错误码为 VALIDATION_ERROR', badStage.body?.error?.code, 'VALIDATION_ERROR');

  // ---- Project：列表与按 ID 查询 ----
  section('GET /labs/:labId/projects 与 GET /projects/:projectId');
  const projectList = await req('GET', `/labs/${labId}/projects`, { user: 'user-1' });
  check('列表返回 200', projectList.status, 200);
  check('列表包含刚创建的 Project', projectList.body.projects.some((p) => p.id === projectId), true);

  const projectGet = await req('GET', `/projects/${projectId}`, { user: 'user-1' });
  check('按 ID 查询 200', projectGet.status, 200);
  check('标题一致', projectGet.body?.project?.title, '工作记忆机制研究');

  // ---- Project：objective 变更记录更新时间戳（SPEC-003 #4）----
  section('SPEC-003 #4：objective 变更记录更新时间戳');
  const objBefore = createdProj.body.project.updatedAt;
  const patchedProj = await req('PATCH', `/projects/${projectId}`, {
    user: 'user-1',
    body: { objective: '聚焦工作记忆容量上限与个体差异', status: 'active' },
  });
  check('更新返回 200', patchedProj.status, 200);
  check('objective 已更新', patchedProj.body?.project?.objective, '聚焦工作记忆容量上限与个体差异');
  check(
    '更新时间戳被记录（不早于原值）',
    Date.parse(patchedProj.body?.project?.updatedAt) >= Date.parse(objBefore),
    true,
  );

  // ---- Project：跨 Lab 拒绝（SPEC-003 #3）----
  section('SPEC-003 #3：跨 Lab 访问被拒绝');
  const crossProj = await req('GET', `/projects/${projectId}`, { user: 'user-2' });
  check('他人读取 Project 返回 403', crossProj.status, 403);
  check('错误码为 FORBIDDEN', crossProj.body?.error?.code, 'FORBIDDEN');

  // ---- Task：创建并指派给 Alice（SPEC-004 #1）----
  section('POST /projects/:projectId/tasks 创建 Task 并指派给 Alice');
  const createdTask = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: {
      title: '梳理证据综述',
      description: '整理近十年工作记忆实验证据',
      assigneeAgentId: agentId,
      priority: 'high',
    },
  });
  check('创建返回 201', createdTask.status, 201);
  check('返回持久 task id', typeof createdTask.body?.task?.id === 'string', true);
  check('Task 归属唯一 Project', createdTask.body?.task?.projectId, projectId);
  check('被指派给 Alice', createdTask.body?.task?.assigneeAgentId, agentId);
  check(
    '创建者来源由服务端写入（creatorType=pi, creatorId=user-1）',
    createdTask.body?.task?.creatorType === 'pi' && createdTask.body?.task?.creatorId === 'user-1',
    true,
  );
  check('默认状态为 backlog', createdTask.body?.task?.status, 'backlog');
  const taskId = createdTask.body.task.id;
  console.log(`  Task：${JSON.stringify(createdTask.body.task, null, 2)}`);

  // ---- Task：跨 Lab 指派被拒绝（SPEC-004 #3）----
  section('SPEC-004 #3：跨 Lab 指派被拒绝');
  const otherLab = await req('POST', '/labs', { user: 'user-2', body: { name: '另一个实验室' } });
  const mallory = await req('POST', `/labs/${otherLab.body?.lab?.id}/agents`, {
    user: 'user-2',
    body: { name: 'Mallory' },
  });
  const crossAssign = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: { title: '非法', assigneeAgentId: mallory.body?.agent?.id },
  });
  check('跨 Lab 指派返回 403', crossAssign.status, 403);
  check('错误码为 FORBIDDEN', crossAssign.body?.error?.code, 'FORBIDDEN');

  // ---- Task：非法状态迁移被拒绝（SPEC-004 #4）----
  section('SPEC-004 #4：非法状态迁移被拒绝');
  const invalidTransition = await req('PATCH', `/tasks/${taskId}`, {
    user: 'user-1',
    body: { status: 'completed' },
  });
  check('backlog → completed 返回 400', invalidTransition.status, 400);
  check('错误码为 VALIDATION_ERROR', invalidTransition.body?.error?.code, 'VALIDATION_ERROR');

  // ---- Task：走合法链路到完成，历史保留（SPEC-004 #5）----
  section('SPEC-004 #5：合法迁移到完成，历史保留');
  let lastTask;
  for (const status of ['ready', 'running', 'review', 'completed']) {
    lastTask = await req('PATCH', `/tasks/${taskId}`, {
      user: 'user-1',
      body: { status },
    });
    check(`迁移到 ${status} 返回 200`, lastTask.status, 200);
  }
  check('最终状态为 completed', lastTask.body?.task?.status, 'completed');
  check('标题保留（记录未被删除）', lastTask.body?.task?.title, '梳理证据综述');
  check('指派仍为 Alice', lastTask.body?.task?.assigneeAgentId, agentId);

  // ---- Model Config：配置提供商（SPEC-005 #5）----
  section('SPEC-005：POST /labs/:labId/model-configs 配置模型提供商');
  const cfgRes = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: 'Mock A', provider: 'mock', model: 'mock-a', apiKey: 'sk-demo-alpha' },
  });
  check('创建返回 201', cfgRes.status, 201);
  check('凭据已加密存储（apiKeyConfigured=true）', cfgRes.body?.modelConfig?.apiKeyConfigured, true);
  check('响应不含明文密钥（#5）', JSON.stringify(cfgRes.body).includes('sk-demo-alpha'), false);
  check('响应不含密文字段', 'apiKeyEncrypted' in (cfgRes.body?.modelConfig ?? {}), false);
  const config1Id = cfgRes.body.modelConfig.id;
  console.log(`  ModelConfig：${JSON.stringify(cfgRes.body.modelConfig, null, 2)}`);

  // ---- Model Config：绑定到 Agent（#6 前置）----
  section('SPEC-005：把模型配置挂到 Alice（modelConfigId 引用，非密钥）');
  const bound = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: config1Id },
  });
  check('绑定返回 200', bound.status, 200);
  check('Alice.modelConfigId 指向 config1', bound.body?.agent?.modelConfigId, config1Id);
  check('身份不受影响（name/lab 不变）', bound.body?.agent?.name === 'Alice' && bound.body?.agent?.labId === labId, true);

  // ---- Model Config：网关连接测试（#1/#3）----
  section('SPEC-005：POST /model-configs/:id/test 走 ModelGateway');
  const testOk = await req('POST', `/model-configs/${config1Id}/test`, { user: 'user-1' });
  check('mock 响应 200', testOk.status, 200);
  check('ok=true 且 provider=mock', testOk.body?.ok === true && testOk.body?.provider === 'mock', true);
  check('返回确定性内容', typeof testOk.body?.content === 'string' && testOk.body.content.includes('Mock reply'), true);

  // ---- Model Config：供应商失败归一化（#4，无外网）----
  section('SPEC-005：供应商失败归一化为错误分类（必然不可达端口，确定性）');
  const deadUrl = await closedPortUrl();
  const deadCfg = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: '不可达', provider: 'openai_compatible', model: 'gpt-x', baseUrl: deadUrl },
  });
  check('创建不可达配置 201', deadCfg.status, 201);
  const testDead = await req('POST', `/model-configs/${deadCfg.body.modelConfig.id}/test`, {
    user: 'user-1',
  });
  check('连接失败返回 502', testDead.status, 502);
  check('错误码为 PROVIDER_ERROR', testDead.body?.error?.code, 'PROVIDER_ERROR');
  check('错误分类为 connection_failed', testDead.body?.error?.category, 'connection_failed');
  check('错误信息不含密钥', JSON.stringify(testDead.body).includes('sk-'), false);

  // ---- Model Config：切换配置不改变身份（#6）----
  section('SPEC-005：切换模型配置不改变 Agent 身份或记忆（#6）');
  const cfg2Res = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: 'Mock B', provider: 'mock', model: 'mock-b', apiKey: 'sk-demo-beta' },
  });
  check('创建第二个配置 201', cfg2Res.status, 201);
  const config2Id = cfg2Res.body.modelConfig.id;
  const switched = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: config2Id },
  });
  check('切换到 config2 返回 200', switched.status, 200);
  check('modelConfigId 已切换', switched.body?.agent?.modelConfigId, config2Id);
  check(
    '身份与记忆不变（name/role/lab/status）',
    switched.body?.agent?.name === 'Alice' &&
      switched.body?.agent?.role === 'phd_researcher' &&
      switched.body?.agent?.labId === labId &&
      switched.body?.agent?.status === 'inactive',
    true,
  );

  // ---- Model Config：严格输入校验（SPEC-005 前置）----
  section('SPEC-005：严格输入校验');
  const badProv = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: 'X', provider: 'anthropic', model: 'm' },
  });
  check('不支持的 provider 返回 400', badProv.status, 400);
  check('错误码为 VALIDATION_ERROR', badProv.body?.error?.code, 'VALIDATION_ERROR');
  const badKey = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: 'X', provider: 'mock', model: 'm', api_key: 'sk-topsecret' },
  });
  check('旧字段名 api_key 被拒绝（400）', badKey.status, 400);

  // ---- SPEC-006：Agent Runtime ----
  // 重新激活 Alice（SPEC-002 段落曾把她停用），准备执行有界任务。
  section('SPEC-006：把 Alice 重新激活，准备执行有界任务');
  const reactivated = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { status: 'active' },
  });
  check('重新激活返回 200', reactivated.status, 200);
  check('Alice 状态为 active', reactivated.body?.agent?.status, 'active');

  // 新建一个有界任务并推进到 running（mock 的完成提案才合法）。
  section('SPEC-006：创建有界任务并推进到 running');
  const t1 = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: {
      title: '整理证据综述（二稿）',
      description: '补充 2020–2026 年文献证据',
      assigneeAgentId: agentId,
      priority: 'high',
    },
  });
  check('创建返回 201', t1.status, 201);
  const t1Id = t1.body.task.id;
  for (const status of ['ready', 'running']) {
    const move = await req('PATCH', `/tasks/${t1Id}`, { user: 'user-1', body: { status } });
    check(`迁移到 ${status} 返回 200`, move.status, 200);
  }

  section('SPEC-006：POST /agents/:agentId/runs 执行一次有界任务（验收 #4）');
  const runOk = await req('POST', `/agents/${agentId}/runs`, {
    user: 'user-1',
    body: { taskId: t1Id, instruction: '梳理证据并给出结构化结论', maxTokens: 2048 },
  });
  check('执行返回 201', runOk.status, 201);
  const run = runOk.body?.run;
  check('run.status = succeeded', run?.status, 'succeeded');
  check('run.errorCategory = null', run?.errorCategory, null);
  check('run 携带 Agent 引用', run?.agentId, agentId);
  check('run 携带 Project 引用', run?.projectId, projectId);
  check('run 携带 Task 引用', run?.taskId, t1Id);
  check('run 携带 provider 引用', run?.provider, 'mock');
  check('run 携带 model 引用（Mock B）', run?.model, 'mock-b');
  check('result.task_status = completed', run?.result?.task_status, 'completed');
  check('result 是结构化结果（7 个字段）', Object.keys(run?.result ?? {}).length, 7);
  const runId = run?.id;
  console.log(`  Run：${JSON.stringify(run, null, 2)}`);

  section('SPEC-006：结果被应用，建议保持为提案（验收 #5）');
  const afterRun = await req('GET', `/tasks/${t1Id}`, { user: 'user-1' });
  check('任务被完成（状态机应用）', afterRun.body?.task?.status, 'completed');
  check('任务描述保留', afterRun.body?.task?.description, '补充 2020–2026 年文献证据');
  check('run 记录 1 条建议任务（未实体化）', run?.result?.suggested_tasks?.length, 1);
  check('run 记录 1 条记忆候选（未实体化）', run?.result?.memory_candidates?.length, 1);
  check('run 记录 1 条产物提案，且已回填创建的 Artifact id（SPEC-008 实体化）', run?.result?.artifact_proposals?.length === 1 && typeof run?.result?.artifact_proposals?.[0]?.id === 'string', true);
  const allTasks = await req('GET', `/projects/${projectId}/tasks`, { user: 'user-1' });
  check('Project 下没有因运行新增 Task（仍为 2 条）', allTasks.body?.tasks?.length, 2);

  // 验收 #1/#2：原始文本不能改变状态。把一个本地桩配成 openai_compatible，
  // 它返回的 content 是普通文本（不是结构化 JSON）→ schema 校验失败 → retryable。
  section('SPEC-006：原始文本不能改变状态，schema 失败 → retryable（验收 #1/#2）');
  const t2 = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: { title: '撰写方法论段落', assigneeAgentId: agentId },
  });
  const t2Id = t2.body.task.id;
  for (const status of ['ready', 'running']) {
    await req('PATCH', `/tasks/${t2Id}`, { user: 'user-1', body: { status } });
  }
  rawServer = await rawTextServer();
  const rawCfg = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: {
      name: '原始文本桩',
      provider: 'openai_compatible',
      model: 'plain-text-x',
      baseUrl: rawServer.url,
    },
  });
  check('创建原始文本配置 201', rawCfg.status, 201);
  const bindRaw = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: rawCfg.body.modelConfig.id },
  });
  check('把 Alice 切到原始文本配置', bindRaw.status, 200);
  const runRaw = await req('POST', `/agents/${agentId}/runs`, {
    user: 'user-1',
    body: { taskId: t2Id },
  });
  check('运行返回 201（失败也落库、可追踪）', runRaw.status, 201);
  check('run.status = retryable', runRaw.body?.run?.status, 'retryable');
  check('run.errorCategory = schema', runRaw.body?.run?.errorCategory, 'schema');
  check('run.result = null（原始文本未被应用）', runRaw.body?.run?.result, null);
  const t2After = await req('GET', `/tasks/${t2Id}`, { user: 'user-1' });
  check('任务状态未被原始文本改变（仍 running）', t2After.body?.task?.status, 'running');

  // 验收 #3：供应商失败不破坏任务状态。把 Alice 切到「必然不可达」的配置。
  section('SPEC-006：供应商失败不破坏任务状态 → retryable（验收 #3）');
  const bindDead = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: deadCfg.body.modelConfig.id },
  });
  check('把 Alice 切到不可达配置', bindDead.status, 200);
  const runDead = await req('POST', `/agents/${agentId}/runs`, {
    user: 'user-1',
    body: { taskId: t2Id },
  });
  check('运行返回 201', runDead.status, 201);
  check('run.status = retryable', runDead.body?.run?.status, 'retryable');
  check('run.errorCategory = provider', runDead.body?.run?.errorCategory, 'provider');
  const t2Still = await req('GET', `/tasks/${t2Id}`, { user: 'user-1' });
  check('任务状态未被供应商失败污染（仍 running）', t2Still.body?.task?.status, 'running');

  // 非法状态迁移：任务停在 backlog，mock 仍提议 completed → transition 失败。
  section('SPEC-006：非法状态迁移 → failed/transition，任务不变');
  const bindBack = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: config2Id },
  });
  check('把 Alice 切回 Mock B', bindBack.status, 200);
  const t3 = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: { title: '待定任务（保持 backlog）', assigneeAgentId: agentId },
  });
  const t3Id = t3.body.task.id;
  const runBad = await req('POST', `/agents/${agentId}/runs`, {
    user: 'user-1',
    body: { taskId: t3Id },
  });
  check('运行返回 201', runBad.status, 201);
  check('run.status = failed', runBad.body?.run?.status, 'failed');
  check('run.errorCategory = transition', runBad.body?.run?.errorCategory, 'transition');
  const t3After = await req('GET', `/tasks/${t3Id}`, { user: 'user-1' });
  check('任务保持 backlog（未被强行完成）', t3After.body?.task?.status, 'backlog');

  // 配置失败：Bob 没有模型配置 → failed/config（可追踪，不是崩溃）。
  section('SPEC-006：未配置模型的 Agent → failed/config（可追踪，非崩溃）');
  const bob = await req('POST', `/labs/${labId}/agents`, {
    user: 'user-1',
    body: { name: 'Bob' },
  });
  const bobId = bob.body?.agent?.id;
  const t4 = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: { title: 'Bob 的任务（无模型配置）', assigneeAgentId: bobId },
  });
  const t4Id = t4.body.task.id;
  const runCfg = await req('POST', `/agents/${bobId}/runs`, {
    user: 'user-1',
    body: { taskId: t4Id },
  });
  check('运行返回 201', runCfg.status, 201);
  check('run.status = failed', runCfg.body?.run?.status, 'failed');
  check('run.errorCategory = config', runCfg.body?.run?.errorCategory, 'config');
  check('run.provider = null（无可用 provider 引用）', runCfg.body?.run?.provider, null);

  // 运行日志：按 Agent 列表（最新在前）与按 ID 查询。
  section('SPEC-006：GET /agents/:agentId/runs 与 GET /runs/:runId');
  const runsList = await req('GET', `/agents/${agentId}/runs`, { user: 'user-1' });
  check('列表返回 200', runsList.status, 200);
  check('Alice 已有 4 次运行（成功/原始文本/供应商/迁移）', runsList.body?.runs?.length, 4);
  check('最新在前（transition 失败是最后一次）', runsList.body?.runs?.[0]?.id, runBad.body?.run?.id);
  const getRun = await req('GET', `/runs/${runId}`, { user: 'user-1' });
  check('按 ID 查询 200', getRun.status, 200);
  check('ID 一致', getRun.body?.run?.id, runId);
  check('成功运行的 result 完整取回', getRun.body?.run?.result?.task_status, 'completed');

  // ---- SPEC-007：持久化作用域记忆 ----
  section('SPEC-007：POST /labs/:labId/memory 写入作用域记忆（作者服务端写入）');
  const mAlice = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: {
      scope: 'agent',
      scopeId: agentId,
      memoryType: 'preference',
      content: 'Alice 偏好用表格整理证据',
      sourceType: 'interview',
      sourceId: 'interview-2026-08',
      importance: 5,
    },
  });
  check('写入 agent 作用域 201', mAlice.status, 201);
  check('author 由服务端写入 pi:user-1', mAlice.body?.memory?.authorType === 'pi' && mAlice.body?.memory?.authorId === 'user-1', true);
  check('出处 sourceType/sourceId 完整', mAlice.body?.memory?.sourceType === 'interview' && mAlice.body?.memory?.sourceId === 'interview-2026-08', true);
  const mProj = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: { scope: 'project', scopeId: projectId, content: '本调查聚焦工作记忆容量（working memory capacity）', sourceType: 'note', sourceId: 's3' },
  });
  check('写入 project 作用域 201', mProj.status, 201);
  const mLab = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: { scope: 'lab', content: '实验室政策：引用必须注明出处', sourceType: 'note', sourceId: 's4' },
  });
  check('写入 lab 作用域 201（scopeId 为空）', mLab.status, 201);
  check('lab 作用域 scopeId 为 null', mLab.body?.memory?.scopeId, null);
  const mBob = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: { scope: 'agent', scopeId: bobId, content: 'Bob 的私人笔记：偏好贝叶斯统计', sourceType: 'note', sourceId: 's5' },
  });
  check('写入 Bob 私人记忆 201', mBob.status, 201);

  section('SPEC-007：校验与授权过滤');
  const badLabScope = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: { scope: 'lab', scopeId: 'team-1', content: 'x', sourceType: 'note', sourceId: 's6' },
  });
  check('lab 作用域携带 scopeId 被拒（400）', badLabScope.status, 400);
  const badEmpty = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: { scope: 'lab', content: '', sourceType: 'note', sourceId: 's6' },
  });
  check('空内容被拒（400）', badEmpty.status, 400);
  const badAgent = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-1',
    body: { scope: 'agent', scopeId: 'no-such-agent', content: 'x', sourceType: 'note', sourceId: 's6' },
  });
  check('agent 作用域引用不存在的 Agent 被拒（400）', badAgent.status, 400);
  const otherList = await req('GET', `/labs/${labId}/memory`, { user: 'user-2' });
  check('他人读取记忆 403', otherList.status, 403);
  const otherWrite = await req('POST', `/labs/${labId}/memory`, {
    user: 'user-2',
    body: { scope: 'lab', content: 'x', sourceType: 'note', sourceId: 's6' },
  });
  check('他人写入记忆 403', otherWrite.status, 403);

  section('SPEC-007：GET /labs/:labId/memory 列表与作用域过滤');
  const memList = await req('GET', `/labs/${labId}/memory`, { user: 'user-1' });
  check('列表返回 200', memList.status, 200);
  check('共 4 条记忆', memList.body?.memories?.length, 4);
  const agentOnlyMem = await req('GET', `/labs/${labId}/memory?scope=agent`, { user: 'user-1' });
  check('按 agent 作用域过滤 → 2 条', agentOnlyMem.body?.memories?.length, 2);

  section('SPEC-007：GET /labs/:labId/memory/search 相关记忆检索');
  const searchRes = await req('GET', `/labs/${labId}/memory/search?q=working+memory`, { user: 'user-1' });
  check('搜索返回 200', searchRes.status, 200);
  check('fallback = false（索引正常）', searchRes.body?.fallback, false);
  check('命中 project 记忆（working memory）', searchRes.body?.memories?.some((m) => m.content?.includes('working memory')), true);
  const noHit = await req('GET', `/labs/${labId}/memory/search?q=${encodeURIComponent('量子纠缠')}`, { user: 'user-1' });
  check('无命中返回 0 条', noHit.body?.memories?.length, 0);
  const noQ = await req('GET', `/labs/${labId}/memory/search`, { user: 'user-1' });
  check('缺少 q 返回 400', noQ.status, 400);

  // 端到端：记忆进入 Agent 提示词。memoryEchoServer 把系统提示里的记忆行
  // 原样带回结构化结果，运行成功后 result.summary 就会包含这些记忆行。
  section('SPEC-007：记忆进入 Agent 提示词（验收 #1/#2/#3/#5）');
  echoServer = await memoryEchoServer();
  const echoCfg = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: '记忆回显桩', provider: 'openai_compatible', model: 'echo-x', baseUrl: echoServer.url },
  });
  check('创建记忆回显配置 201', echoCfg.status, 201);
  const bindEcho = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: echoCfg.body.modelConfig.id },
  });
  check('把 Alice 切到记忆回显桩', bindEcho.status, 200);
  const t5 = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: { title: '汇总当前认知', assigneeAgentId: agentId },
  });
  const t5Id = t5.body.task.id;
  for (const status of ['ready', 'running']) {
    await req('PATCH', `/tasks/${t5Id}`, { user: 'user-1', body: { status } });
  }
  const runEcho = await req('POST', `/agents/${agentId}/runs`, {
    user: 'user-1',
    body: { taskId: t5Id },
  });
  check('记忆回显运行 201', runEcho.status, 201);
  check('run.status = succeeded', runEcho.body?.run?.status, 'succeeded');
  const summary = runEcho.body?.run?.result?.summary ?? '';
  check('验收 #1：Alice 取回自己的 agent 记忆', summary.includes('Alice 偏好用表格整理证据'), true);
  check('验收 #3：project 记忆进入提示词', summary.includes('本调查聚焦工作记忆容量'), true);
  check('lab 共享记忆进入提示词', summary.includes('实验室政策：引用必须注明出处'), true);
  check('验收 #2：Bob 的私人记忆未泄露给 Alice', summary.includes('Bob 的私人笔记'), false);
  check('验收 #5：记忆行携带出处（by pi:user-1）', summary.includes('by pi:user-1'), true);
  // 切回 Mock B，保证「重启后仍绑定 config2」的断言成立。
  const bindBack2 = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: config2Id },
  });
  check('把 Alice 切回 Mock B', bindBack2.status, 200);

  section('SPEC-007：运行日志含记忆回显运行（Alice 共 5 次）');
  const runsAfterEcho = await req('GET', `/agents/${agentId}/runs`, { user: 'user-1' });
  check('Alice 现有 5 次运行', runsAfterEcho.body?.runs?.length, 5);
  check('最新一次是记忆回显运行', runsAfterEcho.body?.runs?.[0]?.id, runEcho.body?.run?.id);

  // ---- SPEC-008：持久化研究产物（Artifact）----
  // 第一次成功运行（runOk）用 schema 感知 mock 产出了 1 条产物提案，
  // SPEC-008 把它实体化为 artifacts 表里的一行；失败运行永不产生 Artifact。
  const artifactId = runOk.body?.run?.result?.artifact_proposals?.[0]?.id;
  section('SPEC-008：成功运行把产物提案实体化为持久 Artifact（验收 #1/#5）');
  check('运行结果携带已创建的 Artifact id（服务端回填，模型不可伪造）', typeof artifactId === 'string' && artifactId.length > 0, true);
  const getArtifact = await req('GET', `/artifacts/${artifactId}`, { user: 'user-1' });
  check('按 ID 取回 Artifact 200', getArtifact.status, 200);
  check('Artifact 关联其 Project（验收 #3）', getArtifact.body?.artifact?.projectId, projectId);
  check('Artifact 关联产出 Agent', getArtifact.body?.artifact?.creatorAgentId, agentId);
  check('version = 1（版本元数据保留，验收 #4）', getArtifact.body?.artifact?.version, 1);
  check('type 保留（note）', getArtifact.body?.artifact?.type, 'note');
  check('内容在 Artifact 行中（验收 #5：不只是转录文本）', typeof getArtifact.body?.artifact?.content === 'string' && getArtifact.body?.artifact?.content.length > 0, true);
  console.log(`  Artifact：${JSON.stringify(getArtifact.body?.artifact, null, 2)}`);

  section('SPEC-008：按 Project 列出产物');
  const projArtifacts = await req('GET', `/projects/${projectId}/artifacts`, { user: 'user-1' });
  check('Project 下列出 1 条产物', projArtifacts.body?.artifacts?.length, 1);

  section('SPEC-008：PI 修订产物 → 版本递增（验收 #4）');
  const rev = await req('POST', `/artifacts/${artifactId}/revisions`, {
    user: 'user-1',
    body: { content: '修订版：新增 12 篇 2024 年文献', type: 'report', title: '证据地图 v2' },
  });
  check('修订返回 201', rev.status, 201);
  check('version = 2', rev.body?.artifact?.version, 2);
  check('修订保留 Project 关联', rev.body?.artifact?.projectId, projectId);
  check('修订记录源 Artifact id（版本谱系）', rev.body?.artifact?.metadata?.sourceArtifactId, artifactId);
  const revId = rev.body?.artifact?.id;
  check('修订是新的兄弟行（新 id）', revId !== artifactId, true);
  const projAfterRev = await req('GET', `/projects/${projectId}/artifacts`, { user: 'user-1' });
  check('Project 下共 2 条版本（兄弟行谱系）', projAfterRev.body?.artifacts?.length, 2);

  section('SPEC-008：跨 Lab 读取产物被拒');
  const otherArt = await req('GET', `/artifacts/${artifactId}`, { user: 'user-2' });
  check('他人读取 Artifact 403', otherArt.status, 403);

  // ---- SPEC-009：组会（Group Meeting）----
  // 给 Alice 一张新任务，让她的结构化进展可被确定性「锚定」在这张任务上。
  section('SPEC-009：准备组会（Prepare）——Alice/Bob 的进展基于当前任务/产物');
  const syncTask = await req('POST', `/projects/${projectId}/tasks`, {
    user: 'user-1',
    body: { title: '更新证据地图', assigneeAgentId: agentId },
  });
  check('创建锚定任务 201', syncTask.status, 201);

  const meetRes = await req('POST', `/projects/${projectId}/meetings`, {
    user: 'user-1',
    body: {
      title: '证据综述冲刺例会',
      agenda: '把分布式的综述工作收敛为决策与后续任务',
      participantAgentIds: [agentId, bobId],
    },
  });
  check('创建组会返回 201', meetRes.status, 201);
  check('组会归属唯一 Project（验收 #1）', meetRes.body?.meeting?.projectId, projectId);
  check('初始状态为 scheduled', meetRes.body?.meeting?.status, 'scheduled');
  const meetingId = meetRes.body.meeting.id;
  console.log(`  Meeting：${JSON.stringify(meetRes.body.meeting, null, 2)}`);

  const meetDetail = await req('GET', `/meetings/${meetingId}`, { user: 'user-1' });
  check('详情返回 200', meetDetail.status, 200);
  check('验收 #1：Alice 与 Bob 出席（2 名参与者）', meetDetail.body?.participants?.length, 2);
  const aliceUpdate = meetDetail.body?.updates?.find((u) => u.agentId === agentId);
  check(
    '验收 #2：Alice 的进展锚定在她的当前任务上',
    typeof aliceUpdate?.content === 'string' && aliceUpdate.content.includes('更新证据地图'),
    true,
  );
  check('进展还携带任务 id 数组', Array.isArray(aliceUpdate?.taskIds) && aliceUpdate.taskIds.length > 0, true);

  section('SPEC-009：讨论与 PI 决策（Discussion + Decision，验收 #3）');
  const started = await req('POST', `/meetings/${meetingId}/start`, { user: 'user-1' });
  check('开始讨论 → 200', started.status, 200);
  check('状态变为 in_progress', started.body?.meeting?.status, 'in_progress');
  check('startedAt 被记录', typeof started.body?.meeting?.startedAt === 'string', true);
  const patchedTranscript = await req('PATCH', `/meetings/${meetingId}`, {
    user: 'user-1',
    body: { transcript: 'Alice 汇报进展；PI 决定优先做综述。' },
  });
  check('记录讨论转录 → 200', patchedTranscript.status, 200);
  const decRes = await req('POST', `/meetings/${meetingId}/decisions`, {
    user: 'user-1',
    body: { statement: '下一阶段优先产出证据综述', rationale: '证据地图已齐' },
  });
  check('PI 记录决策返回 201', decRes.status, 201);
  check('madeByType 由服务端写入 pi（客户端不可伪造）', decRes.body?.decision?.madeByType, 'pi');
  check('madeById 即请求者 user-1', decRes.body?.decision?.madeById, 'user-1');

  section('SPEC-009：行动项生成后续任务（Action Items → Tasks，验收 #4）');
  const itemRes = await req('POST', `/meetings/${meetingId}/action-items`, {
    user: 'user-1',
    body: { title: '起草证据综述初稿', assigneeAgentId: agentId },
  });
  check('记录行动项返回 201', itemRes.status, 201);
  const itemId = itemRes.body.actionItem.id;
  const genRes = await req('POST', `/meetings/${meetingId}/action-items/${itemId}/tasks`, {
    user: 'user-1',
  });
  check('行动项生成后续任务返回 201', genRes.status, 201);
  check('任务标题来自行动项', genRes.body?.task?.title, '起草证据综述初稿');
  check('任务落在组会所属 Project', genRes.body?.task?.projectId, projectId);
  check('行动项回填 task_id（链接持久化）', genRes.body?.actionItem?.taskId, genRes.body?.task?.id);
  const followUpTaskId = genRes.body.task.id;

  section('SPEC-009：完成组会 → 写入记忆（Acceptance #5/#6）');
  const completeRes = await req('POST', `/meetings/${meetingId}/complete`, { user: 'user-1' });
  check('完成组会返回 200', completeRes.status, 200);
  check('状态变为 completed（终态、不可变）', completeRes.body?.meeting?.status, 'completed');
  check('endedAt 被记录', typeof completeRes.body?.meeting?.endedAt === 'string', true);
  check('验收 #6：完成态是结构化记录（参与者/进展/决策/行动项/任务 id/记忆 id）', completeRes.body?.resultingTaskIds?.length === 1 && completeRes.body?.decisions?.length === 1 && completeRes.body?.memoryWriteIds?.length === 2, true);
  check('验收 #5：完成时写入 Project 与 Lab 各一条记忆', completeRes.body?.memoryWriteIds?.length, 2);
  check('决策进入组会结果', completeRes.body?.decisions?.[0]?.statement, '下一阶段优先产出证据综述');
  const meetingMemories = await req('GET', `/labs/${labId}/memory`, { user: 'user-1' });
  const meetingRows = meetingMemories.body?.memories?.filter((m) => m.sourceType === 'meeting');
  check('记忆行携带 sourceType=meeting 出处', meetingRows?.length, 2);
  check('记忆行 sourceId 指向组会', meetingRows?.every((m) => m.sourceId === meetingId), true);
  check('project 作用域记忆挂在组会 Project 上', meetingRows?.some((m) => m.scope === 'project' && m.scopeId === projectId), true);

  section('SPEC-009：完成态不可变（决策/行动项被拒）');
  const lateDec = await req('POST', `/meetings/${meetingId}/decisions`, {
    user: 'user-1',
    body: { statement: '迟到的决策' },
  });
  check('已完成的组会拒绝新增决策（400）', lateDec.status, 400);
  check('错误码为 VALIDATION_ERROR', lateDec.body?.error?.code, 'VALIDATION_ERROR');

  // ---- SPEC-010：PI 仪表盘（默认 UI）----
  // 先让一个任务「受阻」：用一个本地桩返回合法但 blocked 的结构化结果，
  // 附带一条等待 PI 的问题与一条产物提案——这正是仪表盘要展示的状态。
  section('SPEC-010：让任务受阻并挂起一个问题（制造仪表盘要展示的状态）');
  blockedServer = await blockedStubServer();
  const blockedCfg = await req('POST', `/labs/${labId}/model-configs`, {
    user: 'user-1',
    body: { name: '受阻桩', provider: 'openai_compatible', model: 'blocked-x', baseUrl: blockedServer.url },
  });
  check('创建受阻桩配置 201', blockedCfg.status, 201);
  const bindBlocked = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: blockedCfg.body.modelConfig.id },
  });
  check('把 Alice 切到受阻桩', bindBlocked.status, 200);
  // 放一个新的独立 Project：仪表盘因此展示「多个进行中的项目」，
  // 也不干扰 SPEC-008 对原 Project「版本谱系 = 2 条」的既有断言。
  const dashProj = await req('POST', `/labs/${labId}/projects`, {
    user: 'user-1',
    body: { title: '元分析优先级调查', status: 'active', stage: 'analyze' },
  });
  check('创建仪表盘演示 Project 201', dashProj.status, 201);
  const dashProjectId = dashProj.body.project.id;
  const tBlocked = await req('POST', `/projects/${dashProjectId}/tasks`, {
    user: 'user-1',
    body: { title: '元分析优先级检索', assigneeAgentId: agentId, priority: 'urgent' },
  });
  const tBlockedId = tBlocked.body.task.id;
  for (const status of ['ready', 'running']) {
    const move = await req('PATCH', `/tasks/${tBlockedId}`, { user: 'user-1', body: { status } });
    check(`迁移到 ${status} 返回 200`, move.status, 200);
  }
  const blockedRun = await req('POST', `/agents/${agentId}/runs`, {
    user: 'user-1',
    body: { taskId: tBlockedId, instruction: '检索并建议优先级', maxTokens: 2048 },
  });
  check('受阻桩运行返回 201', blockedRun.status, 201);
  check('run.status = succeeded（模型调用本身成功）', blockedRun.body?.run?.status, 'succeeded');
  check('run.result.task_status = blocked', blockedRun.body?.run?.result?.task_status, 'blocked');
  check('run 携带 1 条等待 PI 的问题', blockedRun.body?.run?.result?.questions_for_pi?.length, 1);
  check('产物提案已实体化（Artifact id 回填）', typeof blockedRun.body?.run?.result?.artifact_proposals?.[0]?.id === 'string', true);
  const blockedArtifactId = blockedRun.body?.run?.result?.artifact_proposals?.[0]?.id;
  const blockedTaskAfter = await req('GET', `/tasks/${tBlockedId}`, { user: 'user-1' });
  check('任务状态被推进为 blocked（状态机应用）', blockedTaskAfter.body?.task?.status, 'blocked');

  section('SPEC-010：验收 #1 —— GET / 打开即是仪表盘，无需输入');
  const rootDash = await req('GET', '/', { user: 'user-1' });
  check('GET / 重定向到第一个 Lab 的仪表盘（302）', rootDash.status, 302);
  check('Location 指向 /labs/:labId/dashboard', rootDash.headers.get?.('location'), `/labs/${labId}/dashboard`);

  section('SPEC-010：验收 #2/#3/#4 —— 默认 HTML 页展示完整状态');
  const dashHtml = await req('GET', `/labs/${labId}/dashboard`, { user: 'user-1', accept: 'text/html' });
  check('仪表盘 HTML 返回 200', dashHtml.status, 200);
  check('Content-Type 为 text/html', String(dashHtml.headers.get?.('content-type') ?? '').includes('text/html'), true);
  const page = dashHtml.text ?? '';
  check('验收 #1：进行中的项目区块存在', page.includes('进行中的项目'), true);
  check('验收 #1：两个进行中的项目标题可见', page.includes('工作记忆机制研究') && page.includes('元分析优先级调查'), true);
  check('验收 #2：受阻任务在「需要关注的任务」中可见', page.includes('元分析优先级检索') && page.includes('受阻'), true);
  check('验收 #3：等待你的问题可见', page.includes('是否优先整合 2024 年后的元分析？'), true);
  check('验收 #4：成员以持久身份卡片渲染（data-agent-id）', page.includes('data-agent-id='), true);
  check('验收 #4：明确标注「持久实验室成员」', page.includes('持久实验室成员'), true);
  check('最近产物包含受阻运行实体化的产物', page.includes('优先级建议表'), true);
  check('最近决策可见', page.includes('下一阶段优先产出证据综述'), true);
  check('组会入口可见（SPEC-009 的组会）', page.includes('证据综述冲刺例会'), true);
  check('验收 #5：页脚声明不经过任何模型调用', page.includes('不经过任何模型调用'), true);

  section('SPEC-010：同源 JSON 接口（Accept: application/json）');
  const dashJson = await req('GET', `/labs/${labId}/dashboard`, { user: 'user-1', accept: 'application/json' });
  check('JSON 返回 200', dashJson.status, 200);
  check('Content-Type 为 application/json', String(dashJson.headers.get?.('content-type') ?? '').includes('application/json'), true);
  check('JSON 包含 Lab 名称', dashJson.body?.dashboard?.lab?.name, '认知科学实验室（更新）');
  check('验收 #1：projects 数组含两个进行中的项目', dashJson.body?.dashboard?.projects?.some((p) => p.title === '元分析优先级调查' && p.status === 'active' && p.stage === 'analyze') && dashJson.body?.dashboard?.projects?.some((p) => p.title === '工作记忆机制研究'), true);
  check('验收 #2：attentionTasks 包含受阻任务', dashJson.body?.dashboard?.attentionTasks?.some((t) => t.id === tBlockedId && t.status === 'blocked'), true);
  check('验收 #3：questionsForPi 包含等待的问题', dashJson.body?.dashboard?.questionsForPi?.some((q) => q.question === '是否优先整合 2024 年后的元分析？'), true);
  check('验收 #4：agents 数组带持久身份（specialization）', dashJson.body?.dashboard?.agents?.some((a) => a.id === agentId && a.specialization === '工作记忆'), true);
  check('recentArtifacts 含受阻运行产物', dashJson.body?.dashboard?.recentArtifacts?.some((a) => a.id === blockedArtifactId), true);
  check('meetings 含 SPEC-009 组会', dashJson.body?.dashboard?.meetings?.some((m) => m.id === meetingId), true);

  section('SPEC-010：验收 #5 —— 读取仪表盘不产生任何模型调用');
  const runsBeforeDash = await req('GET', `/agents/${agentId}/runs`, { user: 'user-1' });
  const countBeforeDash = runsBeforeDash.body?.runs?.length;
  await req('GET', `/labs/${labId}/dashboard`, { user: 'user-1', accept: 'text/html' });
  await req('GET', `/labs/${labId}/dashboard`, { user: 'user-1', accept: 'application/json' });
  const runsAfterDash = await req('GET', `/agents/${agentId}/runs`, { user: 'user-1' });
  check('读取两次仪表盘后 run 数不变（确定性读模型）', runsAfterDash.body?.runs?.length, countBeforeDash);

  // 切回 Mock B，保证「重启后仍绑定 config2」的既有断言成立。
  const bindBack3 = await req('PATCH', `/agents/${agentId}`, {
    user: 'user-1',
    body: { modelConfigId: config2Id },
  });
  check('把 Alice 切回 Mock B', bindBack3.status, 200);

  // ---- 重启（验收标准 2）----
  section('重启服务进程');
  await stopServer(serverChild);
  serverChild = null;
  console.log('  进程已停止，使用同一数据库文件重新启动…');
  serverChild = await startServer();

  const afterRestart = await req('GET', `/labs/${labId}`, { user: 'user-1' });
  check('重启后 Lab 仍可取回（200）', afterRestart.status, 200);
  check('Lab 名称保持不变', afterRestart.body?.lab?.name, '认知科学实验室（更新）');
  check('Lab ID 保持不变', afterRestart.body?.lab?.id, labId);

  const afterRestartAgent = await req('GET', `/agents/${agentId}`, { user: 'user-1' });
  check('重启后 Alice 仍可取回（200）', afterRestartAgent.status, 200);
  // SPEC-006 段落把 Alice 重新激活，因此重启后应保持 active（状态迁移同样持久化）。
  check('Alice 状态保持 active（SPEC-006 重新激活被持久化）', afterRestartAgent.body?.agent?.status, 'active');
  check('Alice ID 保持不变', afterRestartAgent.body?.agent?.id, agentId);

  const afterRestartProj = await req('GET', `/projects/${projectId}`, { user: 'user-1' });
  check('重启后 Project 仍可取回（200）', afterRestartProj.status, 200);
  check('Project 标题保持不变', afterRestartProj.body?.project?.title, '工作记忆机制研究');
  check('Project 的 objective 更新被保留', afterRestartProj.body?.project?.objective, '聚焦工作记忆容量上限与个体差异');
  check('Project ID 保持不变', afterRestartProj.body?.project?.id, projectId);

  const afterRestartTask = await req('GET', `/tasks/${taskId}`, { user: 'user-1' });
  check('重启后 Task 仍可取回（200）', afterRestartTask.status, 200);
  check('重启后仍指派给 Alice', afterRestartTask.body?.task?.assigneeAgentId, agentId);
  check('重启后状态保持 completed', afterRestartTask.body?.task?.status, 'completed');
  check('重启后描述保留', afterRestartTask.body?.task?.description, '整理近十年工作记忆实验证据');
  check('Task ID 保持不变', afterRestartTask.body?.task?.id, taskId);

  // ---- Model Config：重启后凭据仍可解密（SPEC-005）----
  section('SPEC-005：重启后凭据仍可解密、绑定与列表保持');
  const cfgAfterRestart = await req('POST', `/model-configs/${config1Id}/test`, { user: 'user-1' });
  check('重启后 config1 仍可测试（200，凭据解密成功）', cfgAfterRestart.status, 200);
  check('重启后 provider 为 mock', cfgAfterRestart.body?.provider, 'mock');

  const aliceAfter = await req('GET', `/agents/${agentId}`, { user: 'user-1' });
  check('重启后 Alice 仍绑定 config2', aliceAfter.body?.agent?.modelConfigId, config2Id);

  const cfgListAfter = await req('GET', `/labs/${labId}/model-configs`, { user: 'user-1' });
  check('重启后配置列表 200', cfgListAfter.status, 200);
  check('重启后列表不含明文密钥', JSON.stringify(cfgListAfter.body).includes('sk-demo-alpha'), false);

  // ---- SPEC-006：重启后运行日志仍可取回 ----
  section('SPEC-006：重启后 Agent 运行日志仍可取回');
  const runsAfterRestart = await req('GET', `/agents/${agentId}/runs`, { user: 'user-1' });
  check('重启后 run 列表 200', runsAfterRestart.status, 200);
  check('重启后 6 次运行仍可查（含 SPEC-010 受阻运行）', runsAfterRestart.body?.runs?.length, 6);
  const getRunAfter = await req('GET', `/runs/${runId}`, { user: 'user-1' });
  check('重启后按 ID 查询成功运行 200', getRunAfter.status, 200);
  check('重启后成功运行的 Task 引用不变', getRunAfter.body?.run?.taskId, t1Id);
  check('重启后成功运行的 result 仍完整', getRunAfter.body?.run?.result?.task_status, 'completed');
  const t1After = await req('GET', `/tasks/${t1Id}`, { user: 'user-1' });
  check('重启后任务完成状态保持', t1After.body?.task?.status, 'completed');

  // ---- SPEC-007：重启后记忆仍可取回 ----
  section('SPEC-007：重启后记忆仍可取回（验收 #4）');
  const memAfter = await req('GET', `/labs/${labId}/memory`, { user: 'user-1' });
  check('重启后记忆列表 200', memAfter.status, 200);
  // SPEC-009 组会完成时又写入了 project + lab 两条记忆（sourceType=meeting），因此总数为 6；4 条 SPEC-007 记忆无丢失。
  check('重启后仍为 6 条记忆（4 条 SPEC-007 + 2 条 SPEC-009 组会记忆）', memAfter.body?.memories?.length, 6);
  const searchAfter = await req('GET', `/labs/${labId}/memory/search?q=working+memory`, { user: 'user-1' });
  check('重启后检索仍工作', searchAfter.body?.memories?.some((m) => m.content?.includes('working memory')), true);

  // ---- SPEC-008：重启后 Artifact 仍可取回（验收 #2）----
  section('SPEC-008：重启后 Artifact 仍可取回（验收 #2）');
  const artAfter = await req('GET', `/artifacts/${artifactId}`, { user: 'user-1' });
  check('重启后按 ID 取回原始版 200', artAfter.status, 200);
  check('重启后原始版 version 仍为 1（版本元数据保留，验收 #4）', artAfter.body?.artifact?.version, 1);
  check('重启后仍关联 Project', artAfter.body?.artifact?.projectId, projectId);
  const revAfter = await req('GET', `/artifacts/${revId}`, { user: 'user-1' });
  check('重启后按 ID 取回修订版 200（修订被持久化）', revAfter.status, 200);
  check('重启后修订版 version = 2', revAfter.body?.artifact?.version, 2);
  check('重启后修订版仍指向源 Artifact', revAfter.body?.artifact?.metadata?.sourceArtifactId, artifactId);
  const projArtAfter = await req('GET', `/projects/${projectId}/artifacts`, { user: 'user-1' });
  check('重启后 Project 下列出 2 条版本', projArtAfter.body?.artifacts?.length, 2);

  // ---- SPEC-009：重启后组会结构化结果仍可取回 ----
  section('SPEC-009：重启后组会结构化结果仍可取回');
  const meetAfter = await req('GET', `/meetings/${meetingId}`, { user: 'user-1' });
  check('重启后组会详情 200', meetAfter.status, 200);
  check('重启后状态保持 completed', meetAfter.body?.meeting?.status, 'completed');
  check('重启后参与者仍为 2 人', meetAfter.body?.participants?.length, 2);
  check('重启后决策保留', meetAfter.body?.decisions?.length, 1);
  check('重启后后续任务 id 链接保留', meetAfter.body?.resultingTaskIds?.[0], followUpTaskId);
  check('重启后记忆写入 id 保留（2 条）', meetAfter.body?.memoryWriteIds?.length, 2);

  const followAfter = await req('GET', `/tasks/${followUpTaskId}`, { user: 'user-1' });
  check('重启后由行动项生成的 Task 仍可取回', followAfter.status, 200);
  check('重启后任务标题保留', followAfter.body?.task?.title, '起草证据综述初稿');
  const projMeetAfter = await req('GET', `/projects/${projectId}/meetings`, { user: 'user-1' });
  check('重启后从 Project 仍能看到组会', projMeetAfter.body?.meetings?.map((m) => m.id)?.[0], meetingId);

  // ---- SPEC-010：重启后仪表盘仍展示同一权威状态 ----
  section('SPEC-010：重启后仪表盘仍展示同一权威状态（验收 #2/#3 + 确定性）');
  const dashAfter = await req('GET', `/labs/${labId}/dashboard`, { user: 'user-1', accept: 'text/html' });
  check('重启后仪表盘 HTML 200', dashAfter.status, 200);
  const pageAfter = dashAfter.text ?? '';
  check('重启后受阻任务仍可见', pageAfter.includes('元分析优先级检索') && pageAfter.includes('受阻'), true);
  check('重启后等待的问题仍可见', pageAfter.includes('是否优先整合 2024 年后的元分析？'), true);
  check('重启后持久身份卡片仍可见', pageAfter.includes('data-agent-id='), true);
  const jsonAfter = await req('GET', `/labs/${labId}/dashboard`, { user: 'user-1', accept: 'application/json' });
  check('重启后 JSON 中受阻任务仍在 attentionTasks', jsonAfter.body?.dashboard?.attentionTasks?.some((t) => t.id === tBlockedId && t.status === 'blocked'), true);
  check('重启后问题仍在 questionsForPi', jsonAfter.body?.dashboard?.questionsForPi?.some((q) => q.question === '是否优先整合 2024 年后的元分析？'), true);

  console.log('\n=== 演示完成 ===');
  if (failures === 0) {
    console.log('全部检查通过 ✅');
  } else {
    console.log(`${failures} 项检查失败 ❌`);
  }
} catch (err) {
  failures += 1;
  console.error(`演示出错：${err.message}`);
} finally {
  await stopServer(serverChild);
  if (rawServer) rawServer.close();
  if (echoServer) echoServer.close();
  if (blockedServer) blockedServer.close();
  // Windows 上 SQLite 释放文件句柄可能稍有延迟，重试清理。
  for (let i = 0; i < 5; i += 1) {
    try {
      rmSync(dirname(DB_PATH), { recursive: true, force: true });
      break;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
