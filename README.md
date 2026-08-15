# MiniLab — SPEC-001 (Lab Core) + SPEC-002 (Agent Core) + SPEC-003 (Project System) + SPEC-004 (Task System) + SPEC-005 (Model Gateway) + SPEC-006 (Agent Runtime) + SPEC-007 (Persistent Scoped Memory) + SPEC-008 (Artifacts) + SPEC-009 (Group Meeting) + SPEC-010 (PI Dashboard)

Implementation of [SPEC-001 Lab Core](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/001-lab-core.md),
[SPEC-002 Agent Core](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/002-agent-core.md),
[SPEC-003 Project System](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/003-project-system.md),
[SPEC-004 Task System](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/004-task-system.md),
[SPEC-005 Model Gateway](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/005-model-gateway.md),
[SPEC-006 Agent Runtime](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/006-agent-runtime.md),
[SPEC-007 Persistent Scoped Memory](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/007-persistent-scoped-memory.md),
[SPEC-008 Artifacts](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/008-artifacts.md)
[SPEC-009 Group Meeting](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/009-group-meeting.md)
and [SPEC-010 PI Dashboard](MiniLab-Development-Pack-v0.1/minilab-development-pack-v0.1/specs/010-pi-dashboard.md):

- **Labs**: a user (PI) creates, lists, retrieves, and updates persistent Labs; ownership is enforced per user.
- **Agents**: a PI hires persistent AI researchers (e.g. Alice) into a Lab; each Agent belongs to exactly
  one Lab, cross-lab access is rejected, and provider secrets never live in the Agent row.
- **Projects**: a PI creates long-running research Projects in a Lab, each carrying a title, objective,
  research stage (a closed enum), and status. Objective changes are recorded with an update timestamp,
  and cross-lab access is rejected.
- **Tasks**: a PI breaks a Project into Tasks assigned to an Agent (e.g. Alice). Each Task belongs to
  exactly one Project, its status advances along a constrained state machine (illegal transitions are
  rejected), the assignee must belong to the same Lab as the Project, and completing a Task never
  deletes its history.
- **Model Gateway**: a provider-neutral model access layer. Agents hold only a *reference*
  (`modelConfigId`) to a per-Lab `ModelConfig`; provider API keys are encrypted at rest
  (AES-256-GCM) and never leave the server as plaintext. All model I/O flows through a
  normalized `ModelRequest`/`ModelResponse`; provider failures map to stable categories
  (e.g. `connection_failed`), and switching a provider config does not alter Agent identity
  or memory.
- **Agent Runtime**: an Agent executes one **bounded task**. A PI triggers a `run` against a
  Task assigned to that Agent; the Runtime retrieves authorized memory, builds context, calls
  the model through `ModelGateway`, validates the structured output against a **typed schema**,
  and applies only the validated `task_status` through the Task state machine. Raw unvalidated
  text can never mutate state (`retryable/schema`); provider failures never corrupt the Task
  (`retryable/provider`); illegal proposed transitions are classified (`failed/transition`);
  suggested tasks / memory candidates stay **proposals** (never materialized); artifact
  proposals are materialized by SPEC-008. Every execution attempt persists one traceable `Run`.
- **Persistent Scoped Memory**: a PI writes durable, scoped memories for an Agent,
  Project, Team, or the whole Lab. Memory is *retrieval-oriented knowledge*, not source
  of truth (Task status stays on the Task; Project stage stays on the Project). Every row
  carries a scope (`agent` / `project` / `team` / `lab`) and full provenance
  (`source_type` / `source_id` / `author_type` / `author_id` — the author is always the
  requesting PI, server-set and unforgeable). Agent Runtime retrieval is scoped to the
  **current Agent + current Project + team/lab-shared** memory — Alice's private memory is
  never visible to Bob. The search index (v0.1: a deterministic offline keyword strategy)
  is only an acceleration layer: if it throws, retrieval falls back to scope-based
  candidates and **canonical memory rows are never deleted**. All of it persists across
  restarts.
- **Artifacts**: Agent work produces durable research outputs that live outside chat
  transcripts. A **succeeded** run materializes its validated `artifact_proposals` into
  `artifacts` rows (failed/retryable runs never do); each Artifact belongs to exactly one
  Project (optional Task/Agent provenance), carries a free-form `type` and **version
  metadata**, and stores its `content` directly in the row — the run transcript is never the
  only home for research output. PIs list a Project's artifacts, read one by ID, and create
  revisions that produce the next `version` as sibling rows (lineage via
  `metadata.sourceArtifactId`). Cross-lab artifacts are never visible. The persisted run
  result backfills the created artifact id server-side (the model cannot forge it). All of it
  persists across restarts.
- **Group Meeting**: a PI turns distributed project work into decisions and follow-up
  tasks (SPEC-009, ADR-0005). A Meeting includes Alice, Bob, and exactly one Project.
  Participant updates are **deterministically assembled** from each Agent's current task /
  artifact rows in that Project at creation (acceptance #2) — no LLM call, so "grounded in
  their current tasks/artifacts" is testable. The PI records **Decisions** (server-set
  provenance `madeByType: "pi"`, unforgeable), and **Action Items** can generate follow-up
  Tasks in the Meeting's Project through the TaskService (idempotent). Completion writes the
  outcome to Project + Lab memory with provenance `sourceType: "meeting"` / `sourceId`
  (acceptance #5); a completed Meeting is immutable. The structured
  `MeetingDetail` — participants, updates, decisions, action items, resulting task ids,
  memory write ids — is the record, not just a transcript (acceptance #6).
- **PI Dashboard**: the product's *default UI* — it tells the PI what is happening in the
  Lab without requiring an empty-prompt interaction (SPEC-010, ADR-0006). `GET /` opens on
  the requester's first Lab's dashboard; `GET /labs/:labId/dashboard` serves the same
  canonical `LabDashboard` as a server-rendered HTML page (browser default) or JSON
  (`Accept: application/json`). The dashboard is a **deterministic read model** over the
  canonical domain rows (projects, agents, tasks, runs, artifacts, meetings, decisions) —
  **no LLM call is ever made** to serve it (acceptance #5). It shows active Projects with
  stage/status, the Agent roster as persistent identity cards (visually distinct from a
  temporary chat participant, acceptance #4), Tasks needing attention (`blocked`/`review`),
  questions waiting for the PI (from the latest succeeded run of each non-terminal task),
  recent Artifacts, recent Decisions, and the Group Meeting entry point.
- **Browser UI（产品化层，JSON API 之外）**: 打开浏览器即可完成**全部核心闭环**，无需 curl。
  仪表盘新增「⚡ 快速操作」面板（一键雇佣成员 / 连接模型，连接模型支持
  `mock` 零成本试玩与任意 openai_compatible 端点）与「🔌 模型配置」列表；项目 /
  成员 / 组会都有独立的 HTML 详情页，带状态流转、执行、决策、行动项等表单操作；
  `GET /labs/:labId/export` 一键导出整个 Lab 的 **Markdown 归档**（成员 / 项目 /
  任务 / 产物 / 组会 / 决策 / 记忆），RFC 5987 正确处理中文文件名。所有页面
  服务端渲染、零内联 JS、用户内容全部 HTML 转义；详情页只对 `Accept` 显式含
  `text/html` 的请求返回 HTML，其余客户端原样落回 JSON API（契约不变）。
- **本地安全硬化**: 服务默认只监听 `127.0.0.1`（`--host` / `HOST` 可放行到
  局域网）；桌面版对走浏览器回退的状态变更请求做 **Origin/Referer 同源校验**
  （跨站表单无法对 `localhost` 发起状态变更）；`GET /health` 提供版本与运行时长探活。

All state persists across application restarts.

> Scope: this implements **only** SPEC-001 … SPEC-010. The search index is a deterministic
> keyword strategy standing in for a real embedding index behind the same
> `MemorySearchStrategy` interface (ADR-0003). Artifact `type` is a free-form string in v0.1
> and is preserved verbatim with its `version` (ADR-0004). The Meeting state machine and
> participant-update assembly are deterministic by design (rule 18); Decisions are PI-authored
> (rule 11) and recorded on the PI's behalf with server-set provenance. The PI Dashboard is
> a deterministic read model over canonical rows — no new entity, no migration, and no LLM
> call (ADR-0006).

> 📖 **完整中文使用教程见 [`docs/USAGE.md`](docs/USAGE.md)**（安装、启动、接口、
> 持久化、测试、FAQ 全覆盖）。

## 获取与安装（Download & Install）

MiniLab 已正式对外发布，三种方式任选：

| 方式 | 说明 | 链接 / 命令 |
| ---- | ---- | ----------- |
| **Windows 桌面版** ⭐ | 单文件、免装 Node.js，下载后双击即用 | https://github.com/JkL-06/minilab/releases/download/v0.2.0/MiniLab.exe |
| **npm 一行命令** | 无需克隆、无需手动装依赖，npm 自动下载并运行最新版 | `npx minilab` |
| **下载网站** | 官方落地页：浏览特性、选安装方式、下载 ZIP | https://jkl-06.github.io/minilab/ |
| **源码仓库** | 公开源码 + MIT 许可证，可自行修改、二次开发 | https://github.com/JkL-06/minilab |

```bash
# 最简单：Windows 用户直接下载桌面版（免装 Node.js，双击即用）
#   https://github.com/JkL-06/minilab/releases/download/v0.2.0/MiniLab.exe

# 其次：一行命令启动（先装好 Node.js 20+）
npx minilab
# → 打开 http://localhost:3000

# 想长期用：装成全局命令，之后直接输入 minilab 启动
npm install -g minilab
minilab

# 从源码跑（本仓库）
git clone https://github.com/JkL-06/minilab
cd minilab && npm install && npm start
```

> 💡 下载的桌面版 exe 若被 Windows SmartScreen 拦下（未签名软件的常规提示）：
> 右键 `MiniLab.exe` → **属性 → 解除锁定**，或点「更多信息 → 仍要运行」即可。
>
> 💡 桌面版双击启动后会**自动打开浏览器进入 PI 仪表盘**（首次启动自动创建一个起始
> Lab「我的实验室」，无需任何输入即可看到实验室当前状态）。它面向单机本地使用，浏览器
> 访问以本地用户身份放行；API 调用仍需携带 `X-User-Id` 头，`npx minilab` 与源码运行
> 方式的行为不变。

- **npm 包**：`minilab@0.2.0` — https://www.npmjs.com/package/minilab
- **许可证**：MIT（见仓库根目录 [`LICENSE`](LICENSE)）
- **完整中文使用教程**：见 [`docs/USAGE.md`](docs/USAGE.md)

> ⚠️ 发布 `minilab` 到 npm 需要账号开启 2FA，并用带 **Bypass 2FA** 权限的
> Granular Access Token（Package access = **All packages**、Permissions = **Read and write**），
> 否则 `npm publish` 返回 403。完整步骤与教训见 [`website/README.md`](website/README.md)。

## Quickstart

```bash
npm install        # 安装依赖（Windows 也可直接双击 start.bat / test.bat）
npm run demo       # 端到端演示：真实启动服务并演练全部接口与验收标准
npm start          # 启动 API → http://localhost:3000
npm test           # 构建 + 运行全部测试
```

## Stack

| Concern        | Choice                                                |
| -------------- | ----------------------------------------------------- |
| Runtime        | Node.js 20 + TypeScript (strict)                      |
| HTTP           | Express 4                                              |
| Validation     | zod (request bodies) + domain invariant checks        |
| Persistence    | SQLite (better-sqlite3), migrations via `schema_migrations` |
| Tests          | `node:test` + supertest, no live model provider       |

### Why SQLite?

ADR-0001 mandates a **relational** database as the system of record and *recommends*
PostgreSQL. SQLite is also a relational database, so it satisfies the ADR decision;
it was chosen over PostgreSQL because this machine has no PostgreSQL server and the
acceptance criteria (offline tests, restart persistence) favor a file-backed engine
with zero external services. The repository interface keeps this swappable: swapping
PostgreSQL later means a new `LabRepository` implementation, not a domain change.

## Layout

```text
src/
  domain/            pure domain: Lab + Agent + Project + Task + ModelConfig + AgentRun +
                     Memory entities, ModelRequest/ModelResponse, invariants, errors
  application/       services (Lab/Agent/Project/Task/ModelConfig/AgentRuntime/Memory/
                     Meeting), repository interfaces, ModelGateway, ProviderAdapter,
                     SecretCipher, result schema, MemorySearchStrategy
  infrastructure/db/ SQLite connection, migrations (v1 labs … v9 meetings), repositories
  infrastructure/models/ credential cipher (AES-256-GCM + master key) and provider adapters
                     (mock / openai_compatible)
  infrastructure/memory/ semantic search (v0.1: deterministic offline KeywordMemorySearch)
  api/               Express routes (labs, agents, projects, tasks, model-configs, runs,
                     memory, meetings), auth stub + desktop CSRF guard, error mapping,
                     app factory; browser UI layer (dashboardView / uiView / uiRoutes /
                     labExportView), served only to `text/html` clients
  server.ts          entry point
tests/
  domain/            entity/validation unit tests
  application/       service ownership tests
  infrastructure/    migration idempotency + persistence across reopen + adapter/cipher tests
  api/               HTTP contract tests (supertest)
  e2e/               acceptance tests: create → restart → retrieve
bin/                npm CLI entry (`bin/minilab.js`) — what `npx minilab` runs
website/            download/install landing page (static, self-contained `index.html`),
                     Chinese, hosting guide in `website/README.md`; `minilab` npm package
                     is published from this repo (see "获取与安装")
```

## Run

```bash
npm install
npm run build        # tsc -> dist/
npm start            # HTTP API on http://localhost:3000, SQLite at ./data/minilab.db
npm test             # build + run all tests (node:test)
```

Configuration via environment:

- `PORT` (default `3000`)
- `HOST` (default `127.0.0.1` — 默认只监听本机；想局域网访问设 `HOST=0.0.0.0`
  或启动时 `minilab --host 0.0.0.0`，并自行评估暴露面)
- `DATABASE_PATH` (default `./data/minilab.db`)
- `MODEL_GATEWAY_KEY` — 64-hex-char master key for credential encryption. When unset, a
  key file `<DATABASE_PATH>.key` is auto-generated next to the database so credentials stay
  decryptable across restarts with zero env plumbing.
- `MINILAB_REQUEST_LOG=1` — 单行请求日志（方法 / 路径 / 状态码 / 耗时），供调试运维。
- `MINILAB_DESKTOP=1`（`bin/minilab.js` 自动设置）— 启用桌面版浏览器回退 + CSRF 同源防护。

## API

Authentication is stubbed: the requesting user is the `X-User-Id` header. Requests
without it receive `401 UNAUTHENTICATED`.

### Labs

| Method | Path            | Body                          | Success                          | Errors                          |
| ------ | --------------- | ----------------------------- | -------------------------------- | ------------------------------- |
| POST   | `/labs`         | `{ name, description? }`      | `201 { lab }`                    | 400, 401                        |
| GET    | `/labs`         | —                             | `200 { labs: Lab[] }` (own only) | 401                             |
| GET    | `/labs/:labId`  | —                             | `200 { lab }`                    | 401, 403, 404                   |
| PATCH  | `/labs/:labId`  | `{ name?, description? }`     | `200 { lab }`                    | 400, 401, 403, 404              |

### Agents

| Method | Path                       | Body                                                      | Success            | Errors              |
| ------ | -------------------------- | -------------------------------------------------------- | ------------------ | ------------------- |
| POST   | `/labs/:labId/agents`      | `{ name, role?, specialization?, profile?, status?, modelConfigId? }` | `201 { agent }` | 400, 401, 403, 404 |
| GET    | `/labs/:labId/agents`      | —                                                        | `200 { agents }`   | 401, 403, 404       |
| GET    | `/agents/:agentId`         | —                                                        | `200 { agent }`    | 401, 403, 404       |
| PATCH  | `/agents/:agentId`         | any optional field                                       | `200 { agent }`    | 400, 401, 403, 404  |

Agent request bodies are `.strict()` — unknown keys such as `api_key`/`secret` are
rejected with `400`, so provider credentials can never be persisted into an Agent row.

`Lab`:

```json
{
  "id": "uuid",
  "ownerUserId": "string",
  "name": "string",
  "description": "string | null",
  "createdAt": "ISO-8601 UTC",
  "updatedAt": "ISO-8601 UTC"
}
```

`Agent`:

```json
{
  "id": "uuid",
  "labId": "uuid",
  "name": "string",
  "role": "string",
  "specialization": "string | null",
  "profile": "string | null",
  "status": "active | inactive",
  "modelConfigId": "string | null",
  "createdAt": "ISO-8601 UTC",
  "updatedAt": "ISO-8601 UTC"
}
```

### Projects

| Method | Path                     | Body                                                   | Success              | Errors              |
| ------ | ------------------------ | ----------------------------------------------------- | -------------------- | ------------------- |
| POST   | `/labs/:labId/projects`  | `{ title, objective?, stage?, status?, teamId? }`      | `201 { project }`    | 400, 401, 403, 404  |
| GET    | `/labs/:labId/projects`  | —                                                     | `200 { projects }`   | 401, 403, 404       |
| GET    | `/projects/:projectId`   | —                                                     | `200 { project }`    | 401, 403, 404       |
| PATCH  | `/projects/:projectId`   | any optional field                                    | `200 { project }`    | 400, 401, 403, 404  |

`stage` must be one of the supported `ResearchStage` enum values — `explore`, `survey`,
`ideate`, `validate`, `develop`, `analyze`, `write`, `submit`, `revise` (default
`explore`) — and `status` one of `planned`, `active`, `blocked`, `paused`, `completed`,
`archived` (default `planned`); both are validated at HTTP and domain level. `teamId`
is a nullable team reference (v0.1 ships a single implicit team). Bodies are `.strict()`
like Agents.

`Project`:

```json
{
  "id": "uuid",
  "labId": "uuid",
  "teamId": "string | null",
  "title": "string",
  "objective": "string | null",
  "stage": "explore | survey | ideate | validate | develop | analyze | write | submit | revise",
  "status": "planned | active | blocked | paused | completed | archived",
  "createdAt": "ISO-8601 UTC",
  "updatedAt": "ISO-8601 UTC"
}
```

### Tasks

| Method | Path                      | Body                                                                     | Success              | Errors              |
| ------ | ------------------------- | ----------------------------------------------------------------------- | -------------------- | ------------------- |
| POST   | `/projects/:projectId/tasks` | `{ title, description?, assigneeAgentId, priority?, dueAt? }`          | `201 { task }`       | 400, 401, 403, 404  |
| GET    | `/projects/:projectId/tasks` | —                                                                      | `200 { tasks }`      | 401, 403, 404       |
| GET    | `/tasks/:taskId`          | —                                                                       | `200 { task }`       | 401, 403, 404       |
| PATCH  | `/tasks/:taskId`          | any of `{ title?, description?, assigneeAgentId?, status?, priority?, dueAt? }` (at least one) | `200 { task }` | 400, 401, 403, 404 |

Task bodies are `.strict()` like Agents. Key invariants (enforced in the domain, checked
again at the HTTP layer):

- `assigneeAgentId` is **required** and must belong to the same Lab as the Project —
  otherwise `403 FORBIDDEN` (SPEC-004 #3).
- Creator provenance (`creatorType`/`creatorId`) is **server-set**: forging it in the
  body returns `400`. A PI-created task gets `creatorType: "pi"`.
- `status` is constrained by a state machine: it starts at `backlog` and only advances
  along legal transitions (e.g. `backlog → ready → running → review → completed`);
  an illegal transition (e.g. `backlog → completed`) returns `400 VALIDATION_ERROR`
  (SPEC-004 #4).
- `priority` is one of `low`/`medium`/`high`/`urgent` (default `medium`); `dueAt` is an
  optional ISO-8601 timestamp (nullable).
- Completing (or cancelling) a Task only changes its status — the row and its history are
  kept (SPEC-004 #5).

`Task`:

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "creatorType": "pi | agent",
  "creatorId": "string",
  "assigneeAgentId": "uuid",
  "title": "string",
  "description": "string | null",
  "status": "backlog | ready | running | blocked | review | completed | cancelled",
  "priority": "low | medium | high | urgent",
  "dueAt": "ISO-8601 UTC | null",
  "createdAt": "ISO-8601 UTC",
  "updatedAt": "ISO-8601 UTC"
}
```

### Model Configs (SPEC-005)

| Method | Path                                 | Body                                                        | Success               | Errors                      |
| ------ | ------------------------------------ | ---------------------------------------------------------- | --------------------- | --------------------------- |
| POST   | `/labs/:labId/model-configs`         | `{ name, provider, model, baseUrl?, apiKey?, isEnabled? }` | `201 { modelConfig }` | 400, 401, 403, 404          |
| GET    | `/labs/:labId/model-configs`         | —                                                          | `200 { modelConfigs }`| 401, 403, 404               |
| GET    | `/model-configs/:modelConfigId`      | —                                                          | `200 { modelConfig }` | 401, 403, 404               |
| PATCH  | `/model-configs/:modelConfigId`      | any optional field (`apiKey` accepts `null` to clear)      | `200 { modelConfig }` | 400, 401, 403, 404          |
| POST   | `/model-configs/:modelConfigId/test` | —                                                          | `200 { ok, provider, model, content, usage }` | 401, 403, 404, **502** |

- `provider` is `openai_compatible` (any OpenAI-style `/chat/completions` endpoint) or
  `mock` (deterministic, offline). Bodies are `.strict()` like the other resources.
- `apiKey` is the only place a credential is accepted: it is encrypted at rest and the
  API only ever reports `apiKeyConfigured: true/false` — never the plaintext, never the
  ciphertext (SPEC-005 #5).
- `POST /model-configs/:id/test` drives the same `ModelGateway` interface the Agent Runtime
  (SPEC-006) calls to execute tasks. Provider failures normalize to `502 PROVIDER_ERROR` on
  the test endpoint, while the Runtime records them as `retryable/provider` runs — a stable
  `category` — `authentication | rate_limit | invalid_request | provider_unavailable |
  connection_failed | invalid_response | unknown` (SPEC-005 #4).
- `PATCH /agents/:agentId { "modelConfigId": <other> }` switches a config without touching
  Agent identity or memory (SPEC-005 #6).

`ModelConfig`:

```json
{
  "id": "uuid",
  "labId": "uuid",
  "name": "string",
  "provider": "openai_compatible | mock",
  "model": "string",
  "baseUrl": "string | null",
  "isEnabled": "boolean",
  "apiKeyConfigured": "boolean",
  "createdAt": "ISO-8601 UTC",
  "updatedAt": "ISO-8601 UTC"
}
```

### Agent Runs (SPEC-006)

| Method | Path                    | Body                                            | Success            | Errors              |
| ------ | ----------------------- | ----------------------------------------------- | ------------------ | ------------------- |
| POST   | `/agents/:agentId/runs` | `{ taskId, instruction?, maxTokens? }`          | `201 { run }` (always created — even on failure) | 400, 401, 403, 404 |
| GET    | `/agents/:agentId/runs` | —                                               | `200 { runs }` (newest first) | 401, 403, 404 |
| GET    | `/runs/:runId`          | —                                               | `200 { run }`      | 401, 403, 404       |

A run executes one bounded task through the deterministic lifecycle
(load Agent → authorize PI → load Task/Project → authorize assignee → resolve config →
retrieve memory → call `ModelGateway` → validate against the typed schema → apply only the
validated `task_status` via the Task state machine → persist). Every execution attempt,
including classified failures, persists a traceable `Run` (acceptance #4). Precondition
violations (unknown agent/task, task not assigned, non-owner, missing auth) throw
400/401/403/404 and produce **no** run record.

- `status`: `succeeded` | `retryable` (`provider`/`schema`) | `failed` (`config`/`transition`).
- `errorCategory`: `null` on success, else `schema` / `provider` / `config` / `transition`.
- `result`: the validated structured result (`resultSchemaVersion: 1`), or `null` when the
  schema check failed / nothing was applied. Raw, unvalidated model text can never change
  task state (acceptance #1/#2); provider failures leave the Task untouched (acceptance #3).
- `result.suggested_tasks` / `memory_candidates` / `artifact_proposals` are recorded as
  **proposals only** — never materialized into Task/memory/artifact rows (acceptance #5).

`Run`:

```json
{
  "id": "uuid",
  "labId": "uuid",
  "agentId": "uuid",
  "projectId": "uuid",
  "taskId": "uuid",
  "modelConfigId": "uuid | null",
  "provider": "string | null",
  "model": "string | null",
  "status": "succeeded | retryable | failed",
  "errorCategory": "schema | provider | config | transition | null",
  "resultSchemaVersion": "number | null",
  "result": {
    "summary": "string",
    "task_status": "completed | blocked | review",
    "artifact_proposals": [{ "title": "string" }],
    "findings": [{ "claim": "string" }],
    "questions_for_pi": [{ "question": "string" }],
    "suggested_tasks": [{ "title": "string", "rationale": "string" }],
    "memory_candidates": [{ "content": "string", "scope": "agent | project | lab" }]
  },
  "startedAt": "ISO-8601 UTC",
  "endedAt": "ISO-8601 UTC",
  "createdAt": "ISO-8601 UTC"
}
```

### Memory (SPEC-007)

| Method | Path                            | Body                                                                 | Success            | Errors              |
| ------ | ------------------------------- | -------------------------------------------------------------------- | ------------------ | ------------------- |
| POST   | `/labs/:labId/memory`           | `{ scope, scopeId?, content, memoryType?, sourceType?, sourceId?, importance? }` | `201 { memory }` | 400, 401, 403, 404 |
| GET    | `/labs/:labId/memory`           | — (optional `?scope=agent&scopeId=…` filter)                         | `200 { memories }` (newest first) | 401, 403, 404 |
| GET    | `/labs/:labId/memory/search`    | `?q=…` (required)                                                    | `200 { query, memories, fallback }` | 400, 401, 403, 404 |

- Memory is **retrieval-oriented knowledge, not source of truth** (ADR-0001/ADR-0003):
  Task status stays on the Task, Project stage stays on the Project. Memories carry the
  context worth remembering and are retrieved into the Agent prompt.
- `scope` is one of `agent` / `project` / `team` / `lab`; `scopeId` is required for
  `agent`/`project`/`team` and must reference an entity **in the same Lab** (a dangling or
  cross-Lab reference → `400`). Lab scope must omit `scopeId`.
- Provenance is **server-set** (rule 17): `authorType` is always `pi` and `authorId` is the
  requesting PI; forging `authorType`/`authorId` in the body returns `400`. `sourceType` /
  `sourceId` record where the memory came from (e.g. `experiment` / `exp-42`).
- Access: a PI can only read/write memory in Labs they own (non-owner → `403`); Agent
  Runtime retrieval returns only **the current Agent's memory + current Project's memory +
  team/lab-shared memory** — Alice's private agent memory never reaches Bob's prompt.
- Search is an **acceleration layer**: `/search` runs the index over all Lab candidates
  (v0.1: deterministic keyword scoring — shared terms ×2, importance breaks ties, zero
  shared terms score zero) and returns `fallback: false`. If the strategy throws, it
  falls back to scope-based retrieval with `fallback: true`; **canonical rows are never
  deleted** (acceptance #6).
- Bodies are `.strict()`; `content` ≤ 10,000 chars; `importance` is an integer 1–5
  (default 3).

`Memory`:

```json
{
  "id": "uuid",
  "labId": "uuid",
  "scope": "agent | project | team | lab",
  "scopeId": "uuid | null",
  "memoryType": "string",
  "content": "string",
  "sourceType": "string",
  "sourceId": "string",
  "authorType": "pi",
  "authorId": "string",
  "importance": "number (1–5)",
  "createdAt": "ISO-8601 UTC"
}
```

### Artifacts (SPEC-008)

| Method | Path | Body | Success | Errors |
| ------ | ---- | ---- | ------- | ------ |
| GET    | `/projects/:projectId/artifacts` | — | `200 { artifacts }` (newest first) | 401, 403, 404 |
| GET    | `/artifacts/:artifactId` | — | `200 { artifact }` | 401, 403, 404 |
| POST   | `/artifacts/:artifactId/revisions` | `{ content, title?, type? }` | `201 { artifact }` (`version+1` sibling row) | 400, 401, 403, 404 |

- **Creation is the Runtime's job** (ADR-0004): a **succeeded** run materializes its
  validated `artifact_proposals` into `artifacts` rows (acceptance #1); failed/retryable runs
  never do. PIs only read and revise — there is no PI "create artifact" endpoint.
- **Transcript text is not the only storage** (acceptance #5): the artifact's `content`
  (≤ 100,000 chars) lives in the `artifacts` table and is retrievable by ID or by Project.
- **Ownership** (acceptance #3): an Artifact belongs to exactly one Project (optional
  `taskId`/`creatorAgentId` provenance); access is authorized through the Project → Lab
  chain, so cross-lab artifacts are never visible (`403`).
- **Version metadata** (acceptance #4): `version` starts at 1; a PI revision writes a **new
  sibling row** (same Project/Task/Agent, `version+1`, `metadata.sourceArtifactId` lineage).
  Reading by the original id always returns that row's own version.
- **Result backfill**: the persisted run result carries each created artifact id in
  `artifact_proposals[].id`, filled in server-side after materialization — the strict schema
  means the model can never forge an id.
- `type` is a free-form string ≤ 100 chars (v0.1 un-enumerated, default `note`); bodies are
  `.strict()`.

`Artifact`:

```json
{
  "id": "uuid",
  "projectId": "uuid",
  "taskId": "uuid | null",
  "creatorAgentId": "uuid | null",
  "type": "string",
  "title": "string",
  "content": "string",
  "version": "number",
  "metadata": { "sourceRunId": "uuid", "sourceType": "agent-run", "sourceArtifactId?": "uuid" },
  "createdAt": "ISO-8601 UTC"
}
```

### Group Meetings (SPEC-009)

| Method | Path | Body | Success | Errors |
| ------ | ---- | ---- | ------- | ------ |
| POST   | `/projects/:projectId/meetings` | `{ title, agenda?, participantAgentIds[] }` | `201 { meeting }` | 400, 401, 403, 404 |
| GET    | `/projects/:projectId/meetings` | — | `200 { meetings }` (newest first) | 401, 403, 404 |
| GET    | `/meetings/:meetingId` | — | `200 { meeting, project, participants, updates, decisions, actionItems, resultingTaskIds, memoryWriteIds }` | 401, 403, 404 |
| PATCH  | `/meetings/:meetingId` | `{ agenda?, transcript? }` (union `string \| null`) | `200 { meeting }` | 400, 401, 403, 404 |
| POST   | `/meetings/:meetingId/start` | — | `200 { meeting }` (`in_progress`, `startedAt`) | 401, 403, 404 |
| POST   | `/meetings/:meetingId/decisions` | `{ statement, rationale? }` | `201 { decision }` | 400, 401, 403, 404 |
| POST   | `/meetings/:meetingId/action-items` | `{ title, assigneeAgentId? }` | `201 { actionItem }` | 400, 401, 403, 404 |
| POST   | `/meetings/:meetingId/action-items/:actionItemId/tasks` | — | `201 { task, actionItem }` | 400, 401, 403, 404 |
| POST   | `/meetings/:meetingId/complete` | — | `200 <MeetingDetail>` | 401, 403, 404 |

- **Workflow** `Prepare → Updates → Discussion → PI Decision → Action Items → Tasks →
  Memory` maps onto status `scheduled → in_progress → completed`; `completed` is terminal
  and **immutable** — later decisions/action items/updates are rejected with `400`
  (ADRs: the Meeting realizes the `Event` entity, `type: "group_meeting"`, in
  `meetings`; details in ADR-0005).
- **Exactly one Project** (acceptance #1): `projectId` is required; the Lab is derived
  through the Project → Lab chain, so a Meeting (and its decisions/updates/… ) is only
  visible to the owning PI's user.
- **Grounded participant updates** (acceptance #2): assembled at creation from each
  participant's persistent Task rows (`assigneeAgentId`) and Artifact rows
  (`creatorAgentId`) in the Meeting's Project — **no LLM call**, so the grounding is
  deterministic and testable. Each update carries `taskIds` / `artifactIds` arrays.
- **PI-orchestrated** (rule 11): Decisions are PI-authored with server-set provenance
  (`madeByType: "pi"`, `madeById` = requester — the client cannot forge it). Action items
  with an assignee generate a follow-up Task in the Meeting's Project via `TaskService`
  (PI-authored); generation is idempotent and records the link on the action item.
- **Memory with provenance** (acceptance #5): completing a Meeting writes the outcome to
  Project- and Lab-scoped memory through `MemoryService` with
  `sourceType: "meeting"` / `sourceId: <meeting id>`; ids are recovered from the memory
  rows' provenance (`memoryWriteIds`), never denormalized.
- **Structured record** (acceptance #6): `GET /meetings/:meetingId` and the completion
  response return the full `MeetingDetail` — participants, updates, decisions, action
  items, `resultingTaskIds`, `memoryWriteIds` — not just a transcript. A meeting with zero
  participants is rejected (`400`, defense-in-depth below the API schema).

`Decision`:

```json
{
  "id": "uuid",
  "labId": "uuid",
  "projectId": "uuid",
  "meetingId": "uuid",
  "madeByType": "pi",
  "madeById": "string",
  "statement": "string",
  "rationale": "string | null",
  "createdAt": "ISO-8601 UTC"
}
```

`ActionItem`:

```json
{
  "id": "uuid",
  "meetingId": "uuid",
  "projectId": "uuid",
  "title": "string",
  "assigneeAgentId": "uuid | null",
  "taskId": "uuid | null",
  "createdAt": "ISO-8601 UTC"
}
```

### PI Dashboard (SPEC-010)

| Method | Path                     | Accept                     | Success                              | Errors              |
| ------ | ------------------------ | -------------------------- | ------------------------------------ | ------------------- |
| GET    | `/`                      | —                          | `302 → /labs/:labId/dashboard` (first Lab) or `200` create-first-Lab page | 401 |
| GET    | `/labs/:labId/dashboard` | `*/*` / `text/html` (default) | `200` HTML page (server-rendered) | 401, 403, 404 |
| GET    | `/labs/:labId/dashboard` | `application/json`         | `200 { dashboard }`                 | 401, 403, 404 |

- **Default UI** (acceptance #1): the product opens on the Lab's state, not on an empty
  prompt. `GET /` redirects to the requester's first Lab's dashboard (or shows a one-line
  "create your first Lab" page when none exists).
- **Deterministic read model** (acceptance #5, ADR-0006): the dashboard is composed from
  the canonical domain rows (projects, agents, tasks, runs, artifacts, meetings, decisions)
  by `DashboardService` — **no LLM call is ever made** to serve it, and reading it never
  creates or mutates state.
- **Content negotiation**: browsers (`Accept: */*` or `text/html`) get a server-rendered
  HTML page with all sections and inline CSS; clients sending `Accept: application/json`
  get the exact same canonical `LabDashboard` as JSON. Both are authorized by Lab ownership
  (`401`/`403`/`404`).
- **Agent identity is persistent** (acceptance #4): Agents render as identity cards with
  role/specialization/status — never as chat messages — so they are visually distinct from
  a temporary chat participant.
- Sections: **active Projects** (status not `completed`/`archived`, newest updated first);
  **Agent roster** (persistent identity + current non-terminal assignments, priority-ordered);
  **Tasks needing attention** (`blocked`/`review` in non-archived Projects); **questions
  waiting for the PI** (from the latest succeeded run of each non-terminal task — a newer
  run supersedes an older one's questions, and terminal tasks' questions are resolved);
  **recent Artifacts**, **recent Decisions**, and the **Group Meeting entry point** (each
  capped at the newest 10).

`LabDashboard` (JSON shape, abbreviated):

```json
{
  "dashboard": {
    "lab": { "id": "…", "name": "…" },
    "projects": [{ "id": "…", "title": "…", "stage": "survey", "status": "active", "updatedAt": "…" }],
    "agents": [{
      "id": "…", "name": "Alice", "role": "phd_researcher", "specialization": "…",
      "status": "active",
      "currentTasks": [{ "id": "…", "title": "…", "status": "blocked", "projectTitle": "…" }],
      "openTaskCount": 1, "blockedTaskCount": 1
    }],
    "attentionTasks": [{ "id": "…", "title": "…", "status": "blocked", "priority": "urgent", "projectTitle": "…", "assigneeName": "Alice" }],
    "questionsForPi": [{ "question": "…", "taskId": "…", "taskTitle": "…", "agentName": "Alice", "runId": "…" }],
    "recentArtifacts": [{ "id": "…", "title": "…", "type": "…", "version": 1, "projectTitle": "…" }],
    "recentDecisions": [{ "id": "…", "statement": "…", "rationale": "…" }],
    "meetings": [{ "id": "…", "title": "…", "status": "…", "projectTitle": "…" }]
  }
}
```

Errors use a stable envelope: `{ "error": { "code", "message", "issues"? } }` with
codes `UNAUTHENTICATED`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`,
`PROVIDER_ERROR` (502, with `category`), `INTERNAL_ERROR`.

## Acceptance criteria coverage

### SPEC-001 (Lab Core)

1. **Persistent Lab ID on create** — `POST /labs` returns `201` + `lab.id`
   (UUIDv4); asserted in `tests/api/labRoutes.test.ts`.
2. **Retrievable after restart** — two app instances share one SQLite file;
   create on the first, retrieve on the second (`tests/e2e/labRestart.test.ts`),
   plus a repository-level reopen test (`tests/infrastructure/persistence.test.ts`).
3. **Ownership enforced** — a second user gets `403` on read and update
   (`tests/api/labRoutes.test.ts`, `tests/application/labService.test.ts`).
4. **Empty name rejected** — `400 VALIDATION_ERROR` at both HTTP and domain level.
5. **No live model provider** — zero LLM dependencies; all tests run offline.

### SPEC-002 (Agent Core)

1. **Persistent agent_id on hire** — `POST /labs/:labId/agents` returns `201` +
   `agent.id`; asserted in `tests/api/agentRoutes.test.ts`.
2. **Alice survives restart** — `tests/e2e/agentRestart.test.ts` (two app
   instances, one SQLite file) plus a repository reopen test.
3. **Exactly one Lab** — `labId` is required, non-null, and FK-enforced against
   `labs(id)` (`tests/infrastructure/agentPersistence.test.ts`).
4. **Cross-lab access rejected** — a user who owns a different lab gets `403` on
   `GET/PATCH /agents/:agentId`; asserted at service and HTTP level.
5. **No provider secrets in the Agent row** — the `agents` schema has no secret
   columns (`PRAGMA table_info` assertion), and request bodies carrying `api_key`
   are rejected with `400` by strict zod schemas.
6. **Deactivation keeps history** — `PATCH { status: "inactive" }` retains the
   record; verified at domain, service, persistence, and API level.

### SPEC-003 (Project System)

1. **Project persists across restart** — `POST /labs/:labId/projects` returns `201` +
   `project.id`, and the record survives a real process restart (`npm run demo`) and a
   repository reopen (`tests/e2e/projectRestart.test.ts`,
   `tests/infrastructure/projectPersistence.test.ts`).
2. **Stage must be a supported `ResearchStage`** — an unsupported `stage` is rejected
   with `400` at both HTTP and domain level; the nine enum values are asserted in
   `tests/domain/project.test.ts`.
3. **Cross-lab access rejected** — a user who owns a different lab gets `403` on
   `GET/PATCH /projects/:projectId`; asserted at service, HTTP, and e2e level.
4. **Objective changes recorded with an update timestamp** — `PATCH { objective }` bumps
   `updatedAt` (monotonic, never backwards) and persists it; asserted at domain,
   service, persistence, and API level.

### SPEC-004 (Task System)

1. **PI assigns a Task to Alice** — `POST /projects/:projectId/tasks` returns `201` +
   `task.id` with `assigneeAgentId` set to Alice and server-set `creatorType: "pi"`
   provenance; asserted in `tests/api/taskRoutes.test.ts` and
   `tests/application/taskService.test.ts`.
2. **Task stays associated with Alice across restart** — two app instances share one
   SQLite file: the assignment, status, and priority all persist
   (`tests/e2e/taskRestart.test.ts`, `tests/infrastructure/taskPersistence.test.ts`,
   and the restart section of `npm run demo`).
3. **Assignee must be in the same Lab as the Project** — an Agent from another Lab is
   rejected with `403 FORBIDDEN` at create and on reassignment; asserted at service,
   HTTP, and e2e level.
4. **Illegal status transitions are rejected** — a constrained state machine
   (`TASK_STATUS_TRANSITIONS` in `src/domain/task.ts`) rejects e.g. `backlog → completed`
   with `400 VALIDATION_ERROR`; asserted at domain, service, HTTP, and e2e level.
5. **Completing a Task keeps its history** — advancing to `completed` retains the row,
   title, description, and assignment; asserted at domain, service, persistence, and API
   level.

### SPEC-005 (Model Gateway)

1. **Agent runtime calls `ModelGateway`, not a provider SDK** — the only model-call entry
   point is the `ModelGateway.generate(request, ref)` interface. The `POST
   /model-configs/:id/test` endpoint exercises that same interface today; SPEC-006's Agent
   Runtime will call it. `MockProviderAdapter` never touches the network.
2. **No provider SDK types leak into domain/application** — zero SDK dependencies; the
   working adapter (`OpenAICompatibleAdapter`) uses the built-in `fetch` and maps the raw
   HTTP body onto the normalized `ModelResponse` (`tests/infrastructure/adapters/
   openAiCompatibleAdapter.test.ts`).
3. **Mock provider drives deterministic tests** — the whole suite runs offline; tests and
   the demo script mock responses/failures via `MockProviderAdapter.onCall`.
4. **Provider failures return normalized categories** — status codes and connection
   errors map to `ModelGatewayError` categories, surfaced as `502 PROVIDER_ERROR` +
   `category` (asserted in `tests/api/modelConfigRoutes.test.ts` and the demo's
   unreachable-port section).
5. **Secrets never written to logs** — credentials exist only as ciphertext in
   `model_configs.api_key_encrypted`; responses, lists, and error messages never echo them
   (asserted across service, persistence, API, and e2e tests).
6. **Switching provider config does not alter Agent identity or memory** — `PATCH
   /agents/:agentId { modelConfigId }` swaps the reference only; identity fields are
   untouched and the binding survives restart (`tests/e2e/modelConfigRestart.test.ts`).

### SPEC-006 (Agent Runtime)

1. **Raw, unvalidated text cannot mutate persistent state** — a model reply that is not valid
   structured JSON produces a `retryable/schema` run with `result: null` and leaves the Task
   untouched (asserted in `tests/application/agentRuntimeService.test.ts`,
   `tests/api/agentRunRoutes.test.ts`, and the demo's raw-text stub section).
2. **Schema failures are marked retryable** — `runStatusForFailure` maps `schema` →
   `retryable`; the run is persisted and traceable by ID.
3. **Provider failure does not corrupt Task state** — a `ModelGatewayError` produces a
   `retryable/provider` run and the Task keeps its previous status (asserted at service, API,
   and demo level via the unreachable-port config).
4. **Run metadata links Agent, Project, Task, and provider/model** — a successful run carries
   `agentId`/`projectId`/`taskId`/`modelConfigId`/`provider`/`model`, persists across restart
   (`tests/e2e/agentRunRestart.test.ts`, `tests/infrastructure/agentRunPersistence.test.ts`,
   and the demo's post-restart run-log section).
5. **Suggested tasks stay proposals** — `result.suggested_tasks`/`memory_candidates`/
   `artifact_proposals` are recorded on the run; no Task (or memory/artifact) rows are created
   (asserted at service, API, e2e, and demo level).

### SPEC-007 (Persistent Scoped Memory)

1. **Alice retrieves her own Agent Memory** — writing an `agent`-scope memory for Alice and
   running her task puts it in her system prompt under "Authorized memory:"
   (`tests/e2e/memoryRuntimeFlow.test.ts`, plus the demo's memory-in-prompt stub section).
2. **Bob cannot read Alice-private Memory** — Bob's private agent memory is *absent* from
   Alice's prompt (`doesNotMatch` assertion), and a non-owner gets `403` on every memory
   route (`tests/api/memoryRoutes.test.ts`).
3. **Project Memory retrievable in later project tasks** — the current Project's memory is
   included in the prompt across two tasks and across a restart (e2e acceptance test).
4. **Survives a restart** — memory rows persist across two app instances on one SQLite file
   (`tests/infrastructure/memoryPersistence.test.ts`, `tests/e2e/memoryRuntimeFlow.test.ts`,
   and the demo's restart section).
5. **Exposes source type and source ID** — every row carries `sourceType`/`sourceId`
   (persistence + API assertions), and the prompt renders provenance as `by pi:user-1`
   (rule 17).
6. **Semantic index failure does not erase canonical memory** — an exploding search strategy
   yields `fallback: true` with scope-based candidates and intact rows
   (`tests/application/memoryService.test.ts`).

### SPEC-008 (Artifacts)

1. **A completed Agent run creates an Artifact** — only a `succeeded` run materializes its
   validated `artifact_proposals` into durable `artifacts` rows, and the persisted run result
   carries each created id (`tests/application/agentRuntimeService.test.ts`,
   `tests/api/agentRunRoutes.test.ts`, `tests/api/artifactRoutes.test.ts`).
2. **The Artifact remains accessible after a restart** — two app instances on one SQLite file;
   the reopened instance reads the artifact by id and lists it from its Project
   (`tests/infrastructure/artifactPersistence.test.ts`, `tests/e2e/artifactRestart.test.ts`,
   and the demo's restart section).
3. **The Artifact is linked to its Project** — `projectId` is required; access is authorized
   through the Project → Lab chain, so a cross-lab requester gets `403` and a missing artifact
   gets `404` (`tests/application/artifactService.test.ts`, `tests/api/artifactRoutes.test.ts`).
4. **Version metadata is preserved** — `version` starts at 1; a PI revision writes a new
   sibling row (`version+1`, `metadata.sourceArtifactId`), and reading the original id always
   returns that row's own version (`tests/domain/artifact.test.ts`,
   `tests/e2e/artifactRestart.test.ts`).
5. **Transcript text is not the only storage** — the artifact's content (≤ 100,000 chars) is
   stored inline in the `artifacts` table and retrievable by id or by Project; a proposal
   without content falls back to the run summary so a stored artifact is never empty
   (ADR-0004, `tests/infrastructure/artifactPersistence.test.ts`).

### SPEC-009 (Group Meeting)

1. **A Meeting can include Alice, Bob, and one Project** — `POST /projects/:projectId/meetings`
   returns `201` + `meeting.projectId`; the detail lists both participants
   (`tests/application/meetingService.test.ts`, `tests/api/meetingRoutes.test.ts`,
   `tests/e2e/meetingRestart.test.ts`).
2. **Participant updates are grounded in their current tasks/artifacts** — updates are
   assembled deterministically from Task rows (`assigneeAgentId`) and Artifact rows
   (`creatorAgentId`) in the Meeting's Project at creation; no LLM call, so the grounding is
   asserted exactly (`meetingService.test.ts` asserts the composed content string, and the
   API test asserts Alice's update names her task).
3. **The PI can record a Decision** — `POST /meetings/:meetingId/decisions` returns `201`;
   provenance is server-set (`madeByType: "pi"`, `madeById` = requester) and the body cannot
   forge it (domain + service + API assertions).
4. **Action items can generate follow-up Tasks** — `POST .../action-items/:id/tasks`
   returns `201 { task, actionItem }`; the Task lands in the Meeting's Project, is assigned
   to the item's assignee, the link is backfilled onto the action item (`task_id`), and
   `resultingTaskIds` exposes it. Generation is idempotent (no duplicate Task rows), and an
   item without an assignee is rejected (`tests/application/meetingService.test.ts`).
5. **Meeting completion writes Project/Lab memory with provenance** — completing writes two
   memory rows (`scope: project` + `scope: lab`) via `MemoryService` with
   `sourceType: "meeting"` / `sourceId: <meeting id>`; `memoryWriteIds` are recovered from
   the rows' provenance. Completing again writes no duplicates (idempotent).
6. **Completion is a structured record, not just a transcript** — the completion response
   and `GET /meetings/:meetingId` return participants, updates, decisions, action items,
   `resultingTaskIds`, and `memoryWriteIds`. All of it survives a restart
   (`tests/e2e/meetingRestart.test.ts` + the demo's SPEC-009 post-restart section).

### SPEC-010 (PI Dashboard)

1. **Understand the active Lab state without opening a chat** — `GET /` redirects to the
   first Lab's dashboard, and `GET /labs/:labId/dashboard` (HTML by default) shows active
   Projects with stage/status, the Agent roster, attention Tasks, pending questions, recent
   Artifacts/Decisions, and the Meeting entry point (`tests/api/dashboardRoutes.test.ts`,
   `tests/e2e/dashboardRestart.test.ts`, and the demo's SPEC-010 sections).
2. **Blocked tasks are visible without opening a chat** — `blocked`/`review` tasks in
   non-archived Projects appear in `attentionTasks` (HTML badge `受阻` and JSON feed)
   (`tests/application/dashboardService.test.ts`).
3. **Pending PI questions are visible** — `questions_for_pi` from the **latest succeeded
   run of each non-terminal task** is exposed; a newer run supersedes older questions and a
   run without questions clears them; terminal tasks' questions are resolved
   (`tests/application/dashboardService.test.ts`, `tests/api/dashboardRoutes.test.ts`).
4. **Agent identity is persistent and visually distinct** — agents render as identity cards
   (`data-agent-id`, role/specialization/status, "持久实验室成员"), never as chat messages
   (`src/api/dashboardView.ts`, asserted in the API test).
5. **Dashboard derives from canonical domain state, not an LLM summary** — `DashboardService`
   composes existing repos deterministically; no model call is made to serve it (proved by
   run-count stability in `tests/application/dashboardService.test.ts`,
   `tests/api/dashboardRoutes.test.ts`, and the demo).

## Design notes

- **Layered dependencies point inward**: `domain` ← `application` ←
  `infrastructure`/`api`. No transport or SDK types leak into domain code.
- **Immutability**: IDs are UUIDv4, never mutated; `updatedAt` bumps on update.
- **UTC**: all timestamps stored as ISO-8601 UTC.
- **Deterministic orchestration**: all writes flow
  `validate → authorize → domain invariant → transactional write`.
- **Provenance**: `owner_user_id` on every Lab enables cross-lab read/write
  isolation (DOMAIN_MODEL invariant #5).
- **Encrypted credentials**: provider API keys are AES-256-GCM encrypted at rest
  (v1-prefixed payloads) under a master key from `MODEL_GATEWAY_KEY` or an auto-generated
  `<db>.key` file — the DB never stores plaintext, and nothing is ever echoed to the API
  (SPEC-005 #5).
