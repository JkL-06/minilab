# MiniLab 使用教程（SPEC-001 … 010）

本文档面向交付使用。MiniLab 是一个**持久化的 AI 科研实验室系统**，当前交付：

- **SPEC-001（Lab 核心）**：用户（PI）创建、查询、修改属于自己的、跨重启持久化的实验室容器；
- **SPEC-002（Agent 核心）**：PI 在自己的实验室里**雇佣**持久的 AI 研究员（如 Alice），
  每个 Agent 归属唯一 Lab，跨 Lab 访问被拒绝，模型密钥绝不存入 Agent 记录；
- **SPEC-003（Project 系统）**：PI 在实验室里创建**长期研究项目**，携带标题、目标
  （objective）、研究阶段（stage）与状态（status）；阶段只能是受支持的枚举值，跨 Lab
  访问被拒绝，objective 的每次变更都会记录更新时间戳；
- **SPEC-004（Task 系统）**：PI 把研究项目拆成**任务**并指派给 Agent（如 Alice）；任务
  归属唯一 Project，状态沿受约束的状态机迁移（非法迁移被拒绝），指派者必须与 Project
  同属一个 Lab，**完成一个任务不会删除它的历史**，全部跨重启持久化；
- **SPEC-005（Model Gateway）**：统一模型访问网关。Agent 只持有模型配置的**引用**
  （`modelConfigId`），Provider 密钥（API Key）经 AES-256-GCM **加密后**存入独立配置表，
  任何接口与日志都不回显密钥；所有模型调用走**归一化的 `ModelRequest`/`ModelResponse`**，
  失败被映射为稳定错误分类（如 `connection_failed`），切换模型配置不影响 Agent 身份；
- **SPEC-006（Agent Runtime）**：让 Agent 真正执行一次**有界任务**。PI 对指派给 Agent
  的任务发起一次 `run`，Runtime 检索授权记忆、构建上下文、经 ModelGateway 调用模型、
  用**类型化 schema** 校验结构化输出，最后只把校验通过的 `task_status` 通过状态机应用到
  任务。**原始文本永远不能改变任何状态**（未过校验 → `retryable/schema`）；供应商失败
  → `retryable/provider`（任务不被污染）；非法迁移 → `failed/transition`；建议任务与记忆
  候选**保持为提案**，绝不自动实体化（产物提案由 SPEC-008 实体化）。每次执行都落一条
  可追踪的 `Run` 记录。
- **SPEC-007（Persistent Scoped Memory）**：PI 为 Agent / Project / Team / Lab 写入
  **持久化的有作用域记忆**。记忆是**检索导向的知识**而非事实来源（Task 状态仍留在 Task
  上）。每条记忆都携带作用域（`agent` / `project` / `team` / `lab`）与完整溯源
  （`source_type` / `source_id` / `author_type` / `author_id`，作者恒为发起请求的 PI，
  由服务端写入、不可伪造）。Agent Runtime 只检索**当前 Agent + 当前 Project + 团队/实验室
  共享**的记忆——Alice 的私有记忆 Bob 永远读不到。语义索引（v0.1 为确定性的离线关键词
  策略）只是加速层，失败时回退为基于作用域的检索，**规范记忆行永不删除**。全部跨重启
  持久化。
- **SPEC-008（Artifacts）**：Agent 工作产生**脱离对话转录、可复用的持久研究产物**。
  一次**成功**的 `run` 把校验通过的产物提案**实体化**为 `artifacts` 表里的一行
  （失败/可重试的运行永不产生 Artifact）：每个 Artifact 关联唯一 Project（可选关联 Task
  与产出 Agent），携带自由文本 `type`（v0.1 允许任意字符串）与**版本元数据** `version`，
  内容直接存储在产物行中（转录文本不是唯一存储位置）。PI 可按 Project 列出产物、按 ID
  读取，并**修订**产物生成下一版本（兄弟行谱系，保留 `sourceArtifactId`）；跨 Lab 的产物
  永远不可见。`run` 的持久化结果会**回填**创建出的 Artifact id（服务端写入，模型不可
  伪造）。全部跨重启持久化。
- **SPEC-009（Group Meeting）**：把分散的项目工作**变成决策与后续任务**。PI 为某个
  Project 创建一次**组会**（工作流 `Prepare → Updates → Discussion → PI Decision →
  Action Items → Tasks → Memory`）：Alice、Bob 作为参与者出席，系统在创建时**确定性
  地组装**每个参与者在该项目里当前的 Task / Artifact 作为其进展汇报（验收 #2，不调用
  模型，因此可测试）。讨论转录可记录，PI 可以记录**决策**（`madeByType: "pi"` 由服务端
  写入、客户端不可伪造），**行动项**可以一键**生成后续任务**（幂等，落在组会所属的
  Project，并回填 `task_id` 链接）。**完成组会**会把结果写入 Project 与 Lab 两级记忆
  （出处 `sourceType: "meeting"` / `sourceId: <组会 id>`，验收 #5）；完成态是
  **结构化记录**（参与者 / 进展 / 决策 / 行动项 / 后续任务 id / 记忆 id，验收 #6），
  且**终态不可变**。全部跨重启持久化。
- **SPEC-010（PI Dashboard）**：产品的**默认 UI**——让 PI **打开即看**实验室正在发生什么，
  **不需要先发一条消息**（验收 #1，ADR-0006）。`GET /` 直接重定向到你的第一个 Lab 的仪表盘；
  `GET /labs/:labId/dashboard` 把同一份规范化的 `LabDashboard` 以**服务端渲染的 HTML 页**
  （浏览器默认）或 **JSON**（`Accept: application/json`）返回。仪表盘是**基于规范领域行的
  确定性读模型**——由 `DashboardService` 组合 projects / agents / tasks / runs / artifacts /
  meetings / decisions 得出，**服务仪表盘绝不调用模型**（验收 #5），读取也不会创建或改变任何
  状态。它展示：**进行中的项目**（阶段与状态）、**成员名册**（以**持久身份卡片**呈现，
  与临时对话参与者视觉上区分，验收 #4）、**需要关注的任务**（`blocked` / `review`）、**等待
  PI 的问题**（取自每个未终结任务最近一次成功运行的结果）、**最近产物**、**最近决策**、
  **组会入口**。全部基于持久化状态，跨重启后同一状态仍可见。

---

## 1. 环境要求

| 依赖 | 版本 | 说明 |
| ---- | ---- | ---- |
| Node.js | **20 及以上** | 检查：`node --version` |
| npm | 随 Node.js 自带 | 检查：`npm --version` |

> 无需安装任何数据库服务（内置 SQLite），无需任何模型 API Key。

---

## 2. 安装

在项目根目录（`E:\MiniLab`）执行：

```bash
npm install
```

> 也可直接双击 `start.bat` / `test.bat`，首次运行会自动安装依赖。

---

## 3. 快速上手

### 方式 0：直接用浏览器（推荐，零命令）

启动服务后（见方式 A），用**浏览器**打开 <http://127.0.0.1:3000> 即进入 PI 仪表盘：

- **仪表盘**：打开即是实验室当前状态（项目 / 成员 / 待关注任务 / 等待你的问题 /
  最近产物 / 最近决策 / 组会入口），右上角「⚡ 快速操作」可直接**雇佣成员**与
  **连接模型**（选 `mock` 提供商即可零成本试玩，无需任何 API Key）。
- **详情页**：点项目 / 成员 / 组会名称进入各自的 HTML 页面，派发任务、执行任务、
  改状态、记录决策、添加行动项、完成组会全部是页面表单操作，无需 curl。
- **导出归档**：项目页右上角「⬇ 导出为 Markdown」一键下载整个 Lab 的 Markdown
  归档（成员 / 项目 / 任务 / 产物 / 组会 / 决策 / 记忆）。

> 桌面版（`npx minilab` / Windows exe）启动后会自动打开浏览器并进入仪表盘；
> 它只监听本机 `127.0.0.1`，并对跨站表单请求做同源校验（本地安全）。

### 方式 A：一键启动（Windows 推荐）

双击 **`start.bat`**，或执行：

```bash
npm start
```

服务启动后输出：

```text
MiniLab API listening on http://127.0.0.1:3000
Database: ./data/minilab.db
```

数据保存在 `data/minilab.db`（SQLite 文件），**重启应用后数据不丢**。

### 方式 B：运行端到端演示（零配置，自动起停服务）

```bash
npm run demo
```

演示会真实启动一个服务进程，逐条演练全部接口与验收标准（含**进程重启后数据
仍可取回**），并打印 PASS/FAIL，全部通过则退出码为 0。

### 方式 C：开发热重载

```bash
npm run dev
```

监听 `src/` 变更并自动重启服务。

---

## 4. 接口说明

所有接口需要请求头 `X-User-Id` 标识当前用户（认证方案正式落地前的身份占位，
后续由正式的认证方案替代）。

### Lab 接口

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/labs` | `{ "name", "description"? }` | `201 { lab }` | 400, 401 |
| GET | `/labs` | — | `200 { labs: Lab[] }`（仅自己的） | 401 |
| GET | `/labs/:labId` | — | `200 { lab }` | 401, 403, 404 |
| PATCH | `/labs/:labId` | `{ "name"?, "description"? }` | `200 { lab }` | 400, 401, 403, 404 |

### Agent 接口

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/labs/:labId/agents` | `{ "name", "role"?, "specialization"?, "profile"?, "status"?, "modelConfigId"? }` | `201 { agent }` | 400, 401, 403, 404 |
| GET | `/labs/:labId/agents` | — | `200 { agents: Agent[] }` | 401, 403, 404 |
| GET | `/agents/:agentId` | — | `200 { agent }` | 401, 403, 404 |
| PATCH | `/agents/:agentId` | 任一可选字段 | `200 { agent }` | 400, 401, 403, 404 |

`status` 仅允许 `active` / `inactive`；`PATCH { "status": "inactive" }` 表示**停用**，
记录保留（不删除，不级联删除任何历史）。请求体是**严格模式**：出现未声明字段
（如 `api_key`、`secret`）会直接返回 `400`，确保模型密钥永远不会写进 Agent 行。

### Project 接口

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/labs/:labId/projects` | `{ "title", "objective"?, "stage"?, "status"?, "teamId"? }` | `201 { project }` | 400, 401, 403, 404 |
| GET | `/labs/:labId/projects` | — | `200 { projects: Project[] }` | 401, 403, 404 |
| GET | `/projects/:projectId` | — | `200 { project }` | 401, 403, 404 |
| PATCH | `/projects/:projectId` | 任一可选字段 | `200 { project }` | 400, 401, 403, 404 |

`stage`（研究阶段）仅允许 9 个枚举值：`explore` / `survey` / `ideate` / `validate` /
`develop` / `analyze` / `write` / `submit` / `revise`；`status`（状态）仅允许
`planned` / `active` / `blocked` / `paused` / `completed` / `archived`。两者在接口层与
领域层双重校验，传入不支持的取值直接返回 `400`。`teamId` 是**可空引用**（v0.1 采用
单一隐式团队，暂无独立 Team 实体）。请求体同样为**严格模式**，未声明字段一律 `400`。

### Task 接口

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/projects/:projectId/tasks` | `{ "title", "description"?, "assigneeAgentId", "priority"?, "dueAt"? }` | `201 { task }` | 400, 401, 403, 404 |
| GET | `/projects/:projectId/tasks` | — | `200 { tasks: Task[] }` | 401, 403, 404 |
| GET | `/tasks/:taskId` | — | `200 { task }` | 401, 403, 404 |
| PATCH | `/tasks/:taskId` | `{ "title"?, "description"?, "assigneeAgentId"?, "status"?, "priority"?, "dueAt"? }`（至少一项） | `200 { task }` | 400, 401, 403, 404 |

关键约束（全部在领域层强制，接口层再次校验）：

- **`assigneeAgentId` 必填**（任务存在的意义就是被指派），且**必须与 Project 同属一个
  Lab**，否则 `403 FORBIDDEN`（SPEC-004 #3）；
- **创建者的来源由服务端写入**：请求体里传 `creatorType` / `creatorId` 会直接 `400`，
  你只能成为 PI 创建的 `creatorType=pi` 任务（伪造来源被拒绝）；
- **`status` 由状态机约束**：创建时默认 `backlog`，只允许沿合法迁移推进
  （如 `backlog → ready → running → review → completed`），非法迁移（如
  `backlog → completed`）直接 `400 VALIDATION_ERROR`（SPEC-004 #4）；
- **`priority`** 仅允许 `low` / `medium` / `high` / `urgent`（默认 `medium`）；
  **`dueAt`** 是可选 ISO-8601 时间（可为 `null`）；
- **完成一个任务不会删除它的历史**：状态推进到 `completed` 后，标题、描述、指派等
  全部保留（SPEC-004 #5）；
- 请求体为**严格模式**，未声明字段（含 `api_key` / `creatorType` 等）一律 `400`。

### Model Config 接口（SPEC-005 Model Gateway）

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/labs/:labId/model-configs` | `{ "name", "provider", "model", "baseUrl"?, "apiKey"?, "isEnabled"? }` | `201 { modelConfig }` | 400, 401, 403, 404 |
| GET | `/labs/:labId/model-configs` | — | `200 { modelConfigs: ModelConfig[] }` | 401, 403, 404 |
| GET | `/model-configs/:modelConfigId` | — | `200 { modelConfig }` | 401, 403, 404 |
| PATCH | `/model-configs/:modelConfigId` | 任一可选字段（`apiKey` 可 `null` 清空） | `200 { modelConfig }` | 400, 401, 403, 404 |
| POST | `/model-configs/:modelConfigId/test` | — | `200 { ok, provider, model, content, usage }` | 401, 403, 404, **502** |

关键设计（SPEC-005）：

- **`provider`** 仅允许 `openai_compatible`（兼容任意 OpenAI 风格 `/chat/completions` 端点，
  如 OpenAI / vLLM / Ollama / 本地桩）与 `mock`（确定性测试/演示，不触网）；
- **`apiKey` 是唯一接受密钥的地方**：创建时传入即被 AES-256-GCM 加密后入库；响应里永远只有
  `apiKeyConfigured: true/false`，**绝无明文或密文**；旧字段名 `api_key` 与其它未声明字段
  一律 `400`（严格模式，SPEC-005 #5）；
- **`modelConfigId` 是可换的**：Agent 通过 `PATCH /agents/:agentId` 把 `modelConfigId` 从 A 换
  到 B，身份（name/role/lab/status）与记忆不受影响（SPEC-005 #6）；
- **`POST /model-configs/:modelConfigId/test`** 走真实 `ModelGateway`：`mock` 返回确定性的
  `Mock reply to: …`；Provider 失败被归一化为 `502 PROVIDER_ERROR` + 稳定 `category`
  （`authentication` / `rate_limit` / `invalid_request` / `provider_unavailable` /
  `connection_failed` / `invalid_response` / `unknown`）（SPEC-005 #4）；
- 配置可被 `PATCH { "isEnabled": false }` 停用，停用后网关直接拒绝（`invalid_request`）。

### Agent Run 接口（SPEC-006 Agent Runtime）

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/agents/:agentId/runs` | `{ "taskId", "instruction"?, "maxTokens"? }` | `201 { run }`（成功或失败都会创建 Run） | 400, 401, 403, 404 |
| GET | `/agents/:agentId/runs` | — | `200 { runs: Run[] }`（最新在前） | 401, 403, 404 |
| GET | `/runs/:runId` | — | `200 { run }` | 401, 403, 404 |

关键设计（SPEC-006）：

- **执行一次有界任务**：`POST /agents/:agentId/runs` 让 Agent 对该任务执行**一次**完整的
  Run 生命周期——加载 Agent → 校验 PI 是 Lab 所有者 → 加载 Task/Project → 校验任务确实
  指派给该 Agent → 解析模型配置 → 检索授权记忆 → 构建上下文并调用 ModelGateway → 用
  类型化 schema 校验结构化结果 → 只把校验通过的 `task_status` 经状态机应用到任务 → 持久化
  Run。即便结果是分类失败（见下），Run 也照常落库，**每次模型执行都可按 ID 追踪**
  （SPEC-006 验收 #4）；
- **原始文本永远不能改变状态**（验收 #1/#2）：模型返回的是普通文本而非结构化 JSON 时，
  schema 校验失败，产生 `retryable / schema` 的 Run，`result=null`，**任务状态分毫不动**；
- **供应商失败不污染任务**（验收 #3）：网关报错（如连不上 Provider）产生
  `retryable / provider` 的 Run，任务保持原状，可在恢复后重试；
- **非法迁移是分类失败而非静默跳过**：模型提议的状态迁移（如 `backlog → completed`）若被
  状态机拒绝，产生 `failed / transition` 的 Run，任务保持原状；
- **配置缺失/停用/跨 Lab 是可追踪的失败**：Agent 没有 `modelConfigId`、配置被删/停用或
  指向其它 Lab，产生 `failed / config` 的 Run（配置行未知时 `provider`/`model` 为 `null`），
  而不是把接口打挂；
- **建议永不自动实体化**（验收 #5）：结果里的 `suggested_tasks`、`memory_candidates`、
  `artifact_proposals` 只是**提案**，Run 落库时记录在 `result` 里，**不会创建任何新的
  Task / 记忆 / 产物**；
- 触发前置错误（Agent/Task 不存在、任务未指派给该 Agent、非 Lab 所有者、缺身份）直接返回
  错误码，**不产生 Run 记录**——只有真正的执行尝试才落库。

`Run.status` 只有三种：`succeeded`（成功应用）、`retryable`（可重试的失败：`provider` /
`schema`）、`failed`（终结性失败：`config` / `transition`）。`errorCategory` 对应
`schema` / `provider` / `config` / `transition`，成功时为 `null`。

### Memory 接口（SPEC-007 Persistent Scoped Memory）

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/labs/:labId/memory` | `{ "scope", "scopeId"?, "content", "memoryType"?, "sourceType"?, "sourceId"?, "importance"? }` | `201 { memory }` | 400, 401, 403, 404 |
| GET | `/labs/:labId/memory` | —（`?scope=agent&scopeId=…` 可选过滤） | `200 { memories: Memory[] }`（最新在前） | 401, 403, 404 |
| GET | `/labs/:labId/memory/search?q=…` | `q` 必填 | `200 { query, memories, fallback }` | 400, 401, 403, 404 |

关键设计（SPEC-007）：

- **记忆是检索导向的知识，不是事实来源**（ADR-0001/ADR-0003）：Task 状态仍在 Task 上、
  Project 阶段仍在 Project 上，记忆只承载“值得记住的上下文”，供后续检索进 Agent 提示词；
- **作用域与归属**：`scope` 仅允许 `agent` / `project` / `team` / `lab`；`agent`/`project`/
  `team` 必须携带 `scopeId`，且**必须引用同 Lab 内的实体**（指向其它 Lab 的 Agent /
  Project → `400`）；`lab` 作用域不得携带 `scopeId`；
- **溯源由服务端写入**（规则 17）：`sourceType` / `sourceId` 描述这条记忆的来源
  （如 `experiment` / `exp-42`），`authorType` 恒为 `pi`、`authorId` 恒为发起请求的 PI——
  请求体里传 `authorType` / `authorId` 会直接 `400`（伪造来源被拒绝）；
- **权限**：PI 只能读写自己 Lab 内的记忆（非 Lab 所有者 → `403`）；Agent Runtime 只检索
  **当前 Agent 自己的记忆 + 当前 Project 的记忆 + team/lab 共享记忆**——Alice 的私有
  Agent 记忆永远不会进入 Bob 的提示词（验收 #2）；
- **搜索是加速层，规范行是权威**（验收 #6）：`/search` 对全 Lab 候选跑语义索引
  （v0.1 为确定性的离线关键词打分：共享词 ×2 + importance 作平局决胜，零共享词得零分），
  返回 `fallback: false`；索引策略抛错时回退为作用域检索、`fallback: true`，**规范记忆行
  永不删除**；
- `content` ≤ 10,000 字符；`importance` 为 1–5 的整数（默认 3）；`memoryType` /
  `sourceType` / `sourceId` 均为可选字符串。请求体是**严格模式**，未声明字段一律 `400`。

### Artifact 接口（SPEC-008 Artifacts）

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| GET | `/projects/:projectId/artifacts` | — | `200 { artifacts: Artifact[] }`（最新在前） | 401, 403, 404 |
| GET | `/artifacts/:artifactId` | — | `200 { artifact }` | 401, 403, 404 |
| POST | `/artifacts/:artifactId/revisions` | `{ "content", "title"?, "type"? }` | `201 { artifact }`（version+1 的兄弟行） | 400, 401, 403, 404 |

关键设计（SPEC-008，ADR-0004）：

- **谁创建 Artifact**：创建是 Agent Runtime 的职责——一次**成功**的 `run` 会把它校验通过
  的 `artifact_proposals` **实体化**为 `artifacts` 行（验收 #1）；失败/可重试的运行永不
  产生 Artifact。PI 只**读取**与**修订**，不能手工创建；
- **转录文本不是唯一存储位置**（验收 #5）：Artifact 的内容存储在 `artifacts` 表的
  `content` 列（≤ 100,000 字符），按 ID / 按 Project 均可取回，与 `Run` 转录相互独立；
- **归属与权限**（验收 #3）：每个 Artifact 关联**唯一 Project**（可选 `taskId` /
  `creatorAgentId` 溯源），通过 Project → Lab 链路鉴权，**跨 Lab 的产物永远不可见**（403）；
- **版本元数据**（验收 #4）：`version` 从 1 起；PI 修订产物会生成**新的兄弟行**（新 id、
  新 `createdAt`），保留同一 Project/Task/Agent 关联，`version` +1，并在 `metadata` 里记录
  `sourceArtifactId`（谱系）；按原 id 查询永远得到它自己的版本；
- **结果回填**：`run` 的持久化结果里 `artifact_proposals[].id` 是**服务端**在实体化后回填的
  创建出的 Artifact id——schema 是严格模式，模型永远无法自己伪造 id（规则 8）；
- `type` 为 1–100 字符的自由字符串（v0.1 未限定枚举，默认 `note`）；`title` ≤ 300，
  `content` ≤ 100,000。修订请求体是**严格模式**，未声明字段一律 `400`。

### Group Meeting 接口（SPEC-009 Group Meeting）

| 方法 | 路径 | 请求体 | 成功 | 错误 |
| ---- | ---- | ------ | ---- | ---- |
| POST | `/projects/:projectId/meetings` | `{ "title", "agenda"?, "participantAgentIds": string[] }` | `201 { meeting }` | 400, 401, 403, 404 |
| GET | `/projects/:projectId/meetings` | — | `200 { meetings: Meeting[] }`（最新在前） | 401, 403, 404 |
| GET | `/meetings/:meetingId` | — | `200 <MeetingDetail>`（见下） | 401, 403, 404 |
| PATCH | `/meetings/:meetingId` | `{ "agenda"?, "transcript"? }`（`string \| null`） | `200 { meeting }` | 400, 401, 403, 404 |
| POST | `/meetings/:meetingId/start` | — | `200 { meeting }`（`in_progress`，记录 `startedAt`） | 401, 403, 404 |
| POST | `/meetings/:meetingId/decisions` | `{ "statement", "rationale"? }` | `201 { decision }` | 400, 401, 403, 404 |
| POST | `/meetings/:meetingId/action-items` | `{ "title", "assigneeAgentId"? }` | `201 { actionItem }` | 400, 401, 403, 404 |
| POST | `/meetings/:meetingId/action-items/:actionItemId/tasks` | — | `201 { task, actionItem }` | 400, 401, 403, 404 |
| POST | `/meetings/:meetingId/complete` | — | `200 <MeetingDetail>` | 401, 403, 404 |

关键设计（SPEC-009，ADR-0005）：

- **工作流与状态机**：`Prepare → Updates → Discussion → PI Decision → Action Items → Tasks
  → Memory`，对应状态 `scheduled → in_progress → completed`；**completed 是终态且不可变**
  ——之后再新增决策 / 行动项 / 修改转录一律 `400 VALIDATION_ERROR`。Meeting 是 DOMAIN_MODEL
  中 `Event` 实体（`type: "group_meeting"`）的实现；
- **归属与鉴权**（验收 #1）：Meeting 属于**唯一 Project**（`projectId` 必填），Lab 通过
  Project → Lab 链路推导，跨 Lab 的读取 / 写入一律 `403`；
- **进展基于当前任务与产物**（验收 #2）：创建组会时，系统为每个参与者**确定性**地组装
  进展汇报——来自该项目里 `assigneeAgentId` = 该 Agent 的 Task 行与 `creatorAgentId` = 该
  Agent 的 Artifact 行，**不调用模型**，因此"进展锚定在当前工作"是可测试的。每条更新都带
  `taskIds` / `artifactIds` 数组；
- **PI 主导**（规则 11）：决策由 PI 记录，出处 `madeByType: "pi"`、`madeById` = 发起请求
  的用户，**由服务端写入、客户端无法伪造**（验收 #3）；行动项指定 `assigneeAgentId` 后可
  **生成后续任务**（验收 #4）——任务落在组会所属 Project、指派给该 Agent、由 TaskService
  以 PI 身份创建，`action_item.task_id` 回填链接，重复调用**幂等**（不产生重复任务）；
- **完成即记忆，带出处**（验收 #5）：完成组会时把结果写入 Project 与 Lab 两级记忆，
  出处 `sourceType: "meeting"` / `sourceId: <组会 id>`；`memoryWriteIds` 是从记忆行的出处
  里取回的（不在组会上冗余），完成态重复调用不写重复记忆；
- **结构化记录而非转录**（验收 #6）：`GET /meetings/:meetingId` 与完成响应返回完整的
  `MeetingDetail`（参与者 / 进展 / 决策 / 行动项 / `resultingTaskIds` / `memoryWriteIds`）；
- `title` ≤ 300（非空），`agenda` ≤ 20,000，`statement` ≤ 5,000，`participantAgentIds`
  至少 1 人（服务层亦有防御式校验）；请求体**严格模式**。

### PI Dashboard 接口（SPEC-010 PI Dashboard）

| 方法 | 路径 | `Accept` | 成功 | 错误 |
| ---- | ---- | -------- | ---- | ---- |
| GET | `/` | — | `302 → /labs/:labId/dashboard`（第一个 Lab）；无 Lab 时 `200` 欢迎页 | 401 |
| GET | `/labs/:labId/dashboard` | `*/*` 或 `text/html`（默认） | `200` 服务端渲染的 HTML 页 | 401, 403, 404 |
| GET | `/labs/:labId/dashboard` | `application/json` | `200 { dashboard }` | 401, 403, 404 |

关键设计（SPEC-010，ADR-0006）：

- **默认 UI，无需输入**（验收 #1）：产品**打开即是**实验室当前状态。`GET /` 重定向到请求者
  第一个 Lab 的仪表盘（没有 Lab 时展示一行「先创建一个 Lab」的引导页）；
- **确定性读模型，不调用模型**（验收 #5）：仪表盘由 `DashboardService` **组合规范领域行**
  得出（projects / agents / tasks / runs / artifacts / meetings / decisions），**服务仪表盘
  绝无任何模型调用**；读取也不创建、不修改任何状态（`npm run demo` 用「读两次后 run 数不
  变」证明）；
- **内容协商**：浏览器（`Accept: */*` 或 `text/html`）拿到服务端渲染的 HTML 页（含全部区块
  与内联样式）；请求方带 `Accept: application/json` 时拿到**同一份**规范的 `LabDashboard`
  JSON。两者都按 Lab 归属鉴权（`401`/`403`/`404`）；
- **Agent 是持久身份，视觉上与临时对话参与者区分**（验收 #4）：成员以**身份卡片**渲染
  （头像 + 角色/专长/状态 + 当前任务列表，标注「持久实验室成员」），绝不渲染成聊天消息；
- 区块：**进行中的项目**（状态非 `completed`/`archived`，按最近更新在前）；**成员名册**
  （持久身份 + 当前未终结任务，按优先级 urgent→low 再按更新排）；**需要关注的任务**
  （非归档项目里的 `blocked`/`review`）；**等待你的问题**（取自每个未终结任务**最近一次成功
  运行**的 `questions_for_pi`——更新的运行覆盖旧的，失败的运行或没有问题的运行会清空，
  终结任务的问题视为已解决）；**最近产物 / 最近决策 / 组会入口**（各自取最新 10 条）。
- **产品化增强**（仪表盘之外）：「⚡ 快速操作」面板提供**雇佣成员**与**连接模型**表单
  （`mock` 提供商零成本试玩）；「🔌 模型配置」列表展示已连模型与 Key 状态；成员未配模型
  时给出引导提示；项目 / 成员 / 组会各有 HTML 详情页（`/projects/:id`、`/agents/:id`、
  `/meetings/:id`，仅对 `Accept` 显式含 `text/html` 的请求返回 HTML，其余客户端落回 JSON
  API）；`GET /labs/:labId/export` 导出整个 Lab 的 Markdown 归档。错误 / 提示以
  `?error=` / `?notice=` 闪现横幅展示，重定向目标限制为同源相对路径（防开放重定向）。

### Lab 对象

```json
{
  "id": "3f906b29-9454-4fc8-b62d-4e8091860133",
  "ownerUserId": "user-1",
  "name": "认知科学实验室",
  "description": "研究记忆与决策",
  "createdAt": "2026-08-14T14:15:20.158Z",
  "updatedAt": "2026-08-14T14:15:20.158Z"
}
```

- `id`：不可变 UUIDv4；
- `createdAt` / `updatedAt`：UTC（ISO-8601）；
- 更新时 `updatedAt` 只增不减；`description` 传 `null` 可清空。

### Agent 对象

```json
{
  "id": "64256889-3413-4851-8113-baf354e7101f",
  "labId": "c3205929-cee6-4160-b70a-f567e09710b0",
  "name": "Alice",
  "role": "phd_researcher",
  "specialization": "工作记忆",
  "profile": null,
  "status": "active",
  "modelConfigId": null,
  "createdAt": "2026-08-14T14:26:50.630Z",
  "updatedAt": "2026-08-14T14:26:50.630Z"
}
```

- `id`：不可变 UUIDv4；`labId`：归属的唯一 Lab（v0.1 中每个 Agent 只属于一个 Lab）；
- `role` 默认 `researcher`，可传任意角色（如 `phd_researcher`、`methodologist`）；
- `status`：`active` / `inactive`，停用即 `PATCH` 置为 `inactive`，记录保留；
- `modelConfigId`：**仅引用**模型配置 ID，**绝不存储**任何 Provider 密钥；
- 更新时 `updatedAt` 只增不减；`specialization` / `profile` / `modelConfigId` 传 `null` 可清空。

### Project 对象

```json
{
  "id": "65267f05-a157-466d-b41b-2b1dfeea249e",
  "labId": "5fdde306-7190-4bea-bac6-bbf2a03b80da",
  "teamId": null,
  "title": "工作记忆机制研究",
  "objective": "聚焦工作记忆容量上限与个体差异",
  "stage": "survey",
  "status": "active",
  "createdAt": "2026-08-14T14:33:22.226Z",
  "updatedAt": "2026-08-14T14:33:22.229Z"
}
```

- `id`：不可变 UUIDv4；`labId`：归属的唯一 Lab（跨 Lab 访问被拒绝）；
- `teamId`：可空的团队引用（v0.1 单一隐式团队，传 `null` 可清空）；
- `title`：必填标题；`objective`：研究目标，可空，传 `null` 可清空；
- `stage`：研究阶段，仅允许 `explore` / `survey` / `ideate` / `validate` / `develop` /
  `analyze` / `write` / `submit` / `revise`，创建默认 `explore`；
- `status`：状态，仅允许 `planned` / `active` / `blocked` / `paused` / `completed` /
  `archived`，创建默认 `planned`；
- 每次更新（含 objective 变更）`updatedAt` 都只增不减——**objective 的每次修改都带着
  新的更新时间戳被记录下来**。

### Task 对象

```json
{
  "id": "3f3d6e3a-8b35-4d5c-9c21-6e2d4f0a1b2c",
  "projectId": "65267f05-a157-466d-b41b-2b1dfeea249e",
  "creatorType": "pi",
  "creatorId": "user-1",
  "assigneeAgentId": "64256889-3413-4851-8113-baf354e7101f",
  "title": "梳理证据综述",
  "description": "整理近十年工作记忆实验证据",
  "status": "completed",
  "priority": "high",
  "dueAt": null,
  "createdAt": "2026-08-14T15:15:38.231Z",
  "updatedAt": "2026-08-14T15:15:39.102Z"
}
```

- `id`：不可变 UUIDv4；`projectId`：归属的唯一 Project（跨 Lab 访问被拒绝）；
- `creatorType` / `creatorId`：**服务端写入**的来源记录（`pi` / `agent`），客户端不可伪造；
- `assigneeAgentId`：被指派的 Agent，必须与 Project 同属一个 Lab；
- `title`：必填（1–300 字符）；`description`：可空，传 `null` 可清空；
- `status`：`backlog` / `ready` / `running` / `blocked` / `review` / `completed` /
  `cancelled`，创建默认 `backlog`，沿状态机合法迁移；
- `priority`：`low` / `medium` / `high` / `urgent`，默认 `medium`；
- `dueAt`：可空的 ISO-8601 截止时间；每次更新 `updatedAt` 只增不减；
- **完成 / 取消只改状态，不删记录**——任务完成后的历史仍然可取回。

### ModelConfig 对象

```json
{
  "id": "432ba493-0e16-4437-bbb2-a1b0a279ec60",
  "labId": "e2ab6c70-ee81-4b36-a606-b9775249f197",
  "name": "Mock A",
  "provider": "mock",
  "model": "mock-a",
  "baseUrl": null,
  "isEnabled": true,
  "apiKeyConfigured": true,
  "createdAt": "2026-08-14T15:56:18.526Z",
  "updatedAt": "2026-08-14T15:56:18.526Z"
}
```

- `id`：不可变 UUIDv4；`labId`：归属的唯一 Lab（跨 Lab 访问被拒绝）；
- `provider`：`openai_compatible` / `mock`；`model`：使用的模型名；
- `baseUrl`：OpenAI 兼容端点的基地址（不含 `/chat/completions`），`null` 用默认值
  `https://api.openai.com/v1`；
- `isEnabled`：停用后网关拒绝调用（`PATCH { "isEnabled": false }`）；
- `apiKeyConfigured`：**只告诉你密钥是否已配置**。响应里永远不会出现
  `apiKey` 或 `apiKeyEncrypted` 字段——明文与密文都不出 API（SPEC-005 #5）；
- 密钥真正存放在 `model_configs.api_key_encrypted`（AES-256-GCM `v1:<iv>:<tag>:<ct>`），
  主密钥来自 `MODEL_GATEWAY_KEY` 环境变量或数据库旁的 `<db>.key` 文件，跨重启可解密。

### Run 对象（SPEC-006）

成功运行的示例：

```json
{
  "id": "a400206a-ae2f-4ad3-8c5d-c21eca91a024",
  "labId": "16b20a82-1cd5-4f75-8e02-9f26722ceec8",
  "agentId": "668eb4ac-52c1-4574-99ba-9953d8a6b4bf",
  "projectId": "498453e9-df24-4c2d-83bc-740742d68119",
  "taskId": "5dcd69a8-5917-4284-b2d2-62fbf24fae8b",
  "modelConfigId": "6ff394f8-87d5-416d-9c99-8ff75ba7b59d",
  "provider": "mock",
  "model": "mock-b",
  "status": "succeeded",
  "errorCategory": null,
  "resultSchemaVersion": 1,
  "result": {
    "summary": "Mock completion for: 梳理证据并给出结构化结论",
    "task_status": "completed",
    "artifact_proposals": [{ "title": "Mock artifact proposal" }],
    "findings": [{ "claim": "Mock finding" }],
    "questions_for_pi": [{ "question": "Mock question for the PI" }],
    "suggested_tasks": [{ "title": "Mock suggested follow-up task", "rationale": "…" }],
    "memory_candidates": [{ "content": "Mock memory candidate", "scope": "project" }]
  },
  "startedAt": "2026-08-14T16:32:01.160Z",
  "endedAt": "2026-08-14T16:32:01.162Z",
  "createdAt": "2026-08-14T16:32:01.162Z"
}
```

- `id`：不可变 UUIDv4；`labId`/`agentId`/`projectId`/`taskId`：一次执行把 Agent、Project、
  Task 与模型引用全部串起来（验收 #4），跨 Lab 读取被拒绝；
- `modelConfigId`/`provider`/`model`：实际使用的模型配置与提供商引用；配置行未知时这三者
  为 `null`（配置失败仍可追踪）；
- `status`：`succeeded` / `retryable` / `failed`；`errorCategory`：成功为 `null`，失败为
  `schema` / `provider` / `config` / `transition`；
- `resultSchemaVersion`：结果 schema 版本（当前 `1`）；`result`：校验通过的结构化结果
  （`summary` + `task_status` + 5 类提案），schema 失败或未执行完成时为 `null`；
- `task_status`：模型提议的任务目标状态（`completed` / `blocked` / `review`），只会被状态机
  **合法地**应用；`suggested_tasks` / `memory_candidates` / `artifact_proposals` / `findings` /
  `questions_for_pi` 只是提案，绝不自动实体化（验收 #5）；
- `startedAt`/`endedAt`/`createdAt`：均为 UTC（ISO-8601），`startedAt` 在终止时刻被 `endedAt`/
  `createdAt` 覆盖为最终记录。

失败示例（`retryable / schema`）：

```json
{
  "id": "…",
  "status": "retryable",
  "errorCategory": "schema",
  "result": null,
  "resultSchemaVersion": null,
  "provider": "mock",
  "model": "mock-b"
}
```

### Memory 对象（SPEC-007）

```json
{
  "id": "7f2d6a10-3c8b-4a9e-9d5f-1e0b2c3d4e5f",
  "labId": "16b20a82-1cd5-4f75-8e02-9f26722ceec8",
  "scope": "agent",
  "scopeId": "668eb4ac-52c1-4574-99ba-9953d8a6b4bf",
  "memoryType": "hypothesis",
  "content": "Working-memory load modulates survey outcomes.",
  "sourceType": "experiment",
  "sourceId": "exp-42",
  "authorType": "pi",
  "authorId": "user-1",
  "importance": 5,
  "createdAt": "2026-08-14T17:02:00.000Z"
}
```

- `id`：不可变 UUIDv4；`labId`：归属的唯一 Lab（跨 Lab 读写被拒绝）；
- `scope`：`agent` / `project` / `team` / `lab`；`scopeId`：作用域指向的实体 ID，
  `lab` 作用域为 `null`，其余必须非空且同 Lab；
- `memoryType`：记忆类型（默认 `note`）；`content`：正文（1–10,000 字符）；
- `sourceType` / `sourceId`：来源类型与来源 ID（如实验编号），**规则 17 的溯源字段**，
  让每条记忆可回溯到它来自哪里；
- `authorType` / `authorId`：作者（v0.1 恒为 `pi` + 发起请求的 PI），服务端写入；
- `importance`：1–5 的整数，作为检索打分的平局决胜；
- `createdAt`：UTC（ISO-8601）。

### Artifact 对象（SPEC-008）

```json
{
  "id": "c08d71da-e8f3-4c4a-8850-2332b45a787b",
  "projectId": "5e0cd610-8e88-41ae-a9b9-534d55a7635a",
  "taskId": "30afa383-4a2a-429f-a1aa-547b5788d748",
  "creatorAgentId": "c3d9ee7b-b032-4951-ab87-b8930d21bde8",
  "type": "report",
  "title": "证据地图 v2",
  "content": "修订版：新增 12 篇 2024 年文献",
  "version": 2,
  "metadata": {
    "sourceRunId": "449270b6-5443-4cd6-85a3-a96ea2968459",
    "sourceType": "agent-run",
    "sourceArtifactId": "c08d71da-e8f3-4c4a-8850-2332b45a787b"
  },
  "createdAt": "2026-08-14T17:36:36.596Z"
}
```

- `id`：不可变 UUIDv4；`projectId`：归属的唯一 Project（Artifact 没有 `lab_id`，Lab 通过
  Project 链路推导，跨 Lab 读取被拒绝）；
- `taskId` / `creatorAgentId`：可选溯源，指向产出它的 Task 与 Agent（PI 修订时继承）；
- `type`：自由文本类型（默认 `note`，v0.1 未限定枚举，API 原样保留）；`title` ≤ 300；
- `content`：正文（1–100,000 字符），**存储在 Artifact 行里**，而非只存在于转录文本；
- `version`：正整数版本号（从 1 起）；`metadata`：JSON 对象，含 `sourceRunId`（产出它的
  运行）、`sourceType`（恒为 `agent-run`），修订版额外带 `sourceArtifactId`（谱系）；
- `createdAt`：UTC（ISO-8601）。

### Meeting 对象（SPEC-009）

```json
{
  "id": "e8b28995-2b20-431b-9c98-f53fb7c35ed6",
  "labId": "c8e071a5-44ec-4617-95b7-13d58c720275",
  "projectId": "250a908e-5dfe-468e-9cb7-8b446f22b01f",
  "type": "group_meeting",
  "title": "证据综述推进同步",
  "agenda": "确定下一阶段的优先产出",
  "transcript": null,
  "status": "completed",
  "scheduledAt": null,
  "startedAt": "2026-08-15T04:47:00.222Z",
  "endedAt": "2026-08-15T04:47:00.333Z",
  "createdAt": "2026-08-15T04:47:00.111Z",
  "updatedAt": "2026-08-15T04:47:00.333Z"
}
```

- `type`：恒为 `group_meeting`（SPEC-009 唯一实现，DOMAIN_MODEL 的 `Event` 实体）；
- `status`：`scheduled` → `in_progress` → `completed`（终态、不可变）；
- 时间戳：`startedAt` 在 `start` 时写入，`endedAt` 在 `complete` 时写入；
  `scheduledAt` 为预留字段（v0.1 恒为 `null`）。

### Decision 对象（SPEC-009）

```json
{
  "id": "60f1c0a2-1c9e-4b1a-8f3e-2a5b7c9d1e2f",
  "labId": "c8e071a5-44ec-4617-95b7-13d58c720275",
  "projectId": "250a908e-5dfe-468e-9cb7-8b446f22b01f",
  "meetingId": "e8b28995-2b20-431b-9c98-f53fb7c35ed6",
  "madeByType": "pi",
  "madeById": "user-1",
  "statement": "下一阶段优先产出证据综述初稿",
  "rationale": "证据基础偏薄，先综述后实验",
  "createdAt": "2026-08-15T04:47:00.200Z"
}
```

- `madeByType`：恒为 `pi`（服务端写入，客户端请求体里伪造 → `400`）；
- `madeById`：发起请求的 PI 用户 id（服务端写入）。

### ActionItem 对象（SPEC-009）

```json
{
  "id": "7c9e4b1a-2a5b-7c9d-1e2f-3a4b5c6d7e8f",
  "meetingId": "e8b28995-2b20-431b-9c98-f53fb7c35ed6",
  "projectId": "250a908e-5dfe-468e-9cb7-8b446f22b01f",
  "title": "起草证据综述初稿",
  "assigneeAgentId": "d49f1f60-1266-40fd-b612-71c79d28f1f9",
  "taskId": "01d04247-8515-4f86-900c-bab841b2d1df",
  "createdAt": "2026-08-15T04:47:00.240Z"
}
```

- `assigneeAgentId`：可空；只有带指派人的行动项才能生成后续任务；
- `taskId`：生成后续任务后由服务端**回填**的链接（生成前为 `null`）。

`MeetingDetail`（`GET /meetings/:meetingId` 与 `complete` 的响应）为结构化记录：

```json
{
  "meeting": { "…": "Meeting 对象" },
  "project": { "id": "…", "title": "…" },
  "participants": [{ "agentId": "…", "name": "Alice" }, { "agentId": "…", "name": "Bob" }],
  "updates": [{ "meetingId": "…", "agentId": "…", "content": "Tasks: '…' (…). Artifacts: …", "taskIds": ["…"], "artifactIds": ["…"] }],
  "decisions": [Decision],
  "actionItems": [ActionItem],
  "resultingTaskIds": ["由行动项生成的 Task id"],
  "memoryWriteIds": ["完成时写入的记忆 id"]
}
```

### LabDashboard 对象（SPEC-010）

`GET /labs/:labId/dashboard`（`Accept: application/json`）返回的规范读模型（节选）：

```json
{
  "dashboard": {
    "lab": { "id": "…", "name": "认知科学实验室" },
    "projects": [{ "id": "…", "title": "工作记忆机制研究", "stage": "survey", "status": "active", "updatedAt": "2026-08-15T04:47:00.222Z" }],
    "agents": [{
      "id": "…", "name": "Alice", "role": "phd_researcher", "specialization": "工作记忆",
      "status": "active",
      "currentTasks": [{ "id": "…", "title": "元分析优先级检索", "status": "blocked", "projectTitle": "元分析优先级调查" }],
      "openTaskCount": 1, "blockedTaskCount": 1
    }],
    "attentionTasks": [{ "id": "…", "title": "元分析优先级检索", "status": "blocked", "priority": "urgent", "projectTitle": "元分析优先级调查", "assigneeName": "Alice" }],
    "questionsForPi": [{ "question": "是否优先整合 2024 年后的元分析？", "taskId": "…", "taskTitle": "元分析优先级检索", "agentName": "Alice", "runId": "…" }],
    "recentArtifacts": [{ "id": "…", "title": "优先级建议表", "type": "table", "version": 1, "projectTitle": "元分析优先级调查" }],
    "recentDecisions": [{ "id": "…", "statement": "下一阶段优先产出证据综述初稿", "rationale": "证据基础偏薄" }],
    "meetings": [{ "id": "…", "title": "证据综述冲刺例会", "status": "completed", "projectTitle": "工作记忆机制研究" }]
  }
}
```

- `projects`：**进行中的项目**（状态非 `completed`/`archived`），最新更新在前；
- `agents`：**成员名册**，每个成员携带持久身份（id/name/role/specialization/status）与
  当前未终结任务（`currentTasks`）及计数（`openTaskCount`/`blockedTaskCount`）；
- `attentionTasks`：**需要关注的任务**（非归档项目里的 `blocked`/`review`，优先 urgent 在前）；
- `questionsForPi`：**等待 PI 的问题**（每个未终结任务取**最近一次成功运行**的
  `questions_for_pi`，含任务/Agent/运行引用）；
- `recentArtifacts` / `recentDecisions` / `meetings`：**最近产物 / 最近决策 / 组会入口**，
  各取最新 10 条。

### 错误响应（稳定错误码）

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "name must not be empty" } }
```

| code | HTTP | 含义 |
| ---- | ---- | ---- |
| `UNAUTHENTICATED` | 401 | 缺少 `X-User-Id` 请求头 |
| `VALIDATION_ERROR` | 400 | 请求体或领域校验失败（如空名称） |
| `FORBIDDEN` | 403 | 该用户不是 Lab 所有者 |
| `NOT_FOUND` | 404 | Lab / 配置不存在 |
| `PROVIDER_ERROR` | 502 | 模型 Provider 调用失败，附带归一化 `category`（SPEC-005 #4） |
| `INTERNAL_ERROR` | 500 | 服务端未预期错误 |

`PROVIDER_ERROR` 示例（`/model-configs/:id/test` 连不上 Provider）：

```json
{ "error": { "code": "PROVIDER_ERROR", "category": "connection_failed", "message": "Could not reach the model provider" } }
```

---

## 5. 命令行速查（curl 示例）

```bash
# 创建 Lab
curl -X POST http://localhost:3000/labs \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"name":"认知科学实验室","description":"研究记忆与决策"}'

# 列出我拥有的全部 Lab
curl http://localhost:3000/labs -H "X-User-Id: user-1"

# 按 ID 查询
curl http://localhost:3000/labs/<labId> -H "X-User-Id: user-1"

# 更新名称与描述（description 传 null 清空）
curl -X PATCH http://localhost:3000/labs/<labId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"name":"新名称"}'

# 雇佣 Alice（Agent）
curl -X POST http://localhost:3000/labs/<labId>/agents \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"name":"Alice","role":"phd_researcher","specialization":"工作记忆"}'

# 列出实验室成员
curl http://localhost:3000/labs/<labId>/agents -H "X-User-Id: user-1"

# 按 ID 查询 / 更新 Agent（停用）
curl http://localhost:3000/agents/<agentId> -H "X-User-Id: user-1"
curl -X PATCH http://localhost:3000/agents/<agentId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"status":"inactive"}'

# 在实验室里创建 Project（研究项目）
curl -X POST http://localhost:3000/labs/<labId>/projects \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"title":"工作记忆机制研究","objective":"梳理证据","stage":"survey"}'

# 列出实验室的全部 Project / 按 ID 查询
curl http://localhost:3000/labs/<labId>/projects -H "X-User-Id: user-1"
curl http://localhost:3000/projects/<projectId> -H "X-User-Id: user-1"

# 更新 Project：修改 objective（会记录新的更新时间戳）、推进研究阶段
curl -X PATCH http://localhost:3000/projects/<projectId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"objective":"聚焦工作记忆容量上限","stage":"validate","status":"active"}'

# 在 Project 里创建 Task 并指派给 Alice（必须同 Lab）
curl -X POST http://localhost:3000/projects/<projectId>/tasks \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"title":"梳理证据综述","description":"整理近十年实验证据","assigneeAgentId":"<aliceAgentId>","priority":"high"}'

# 列出该 Project 的全部 Task / 按 ID 查询
curl http://localhost:3000/projects/<projectId>/tasks -H "X-User-Id: user-1"
curl http://localhost:3000/tasks/<taskId> -H "X-User-Id: user-1"

# 推进任务状态（沿状态机合法迁移：backlog → ready → running → review → completed）
curl -X PATCH http://localhost:3000/tasks/<taskId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"status":"ready"}'

# 配置模型提供商（apiKey 会被加密存储，响应永远不含密钥）
curl -X POST http://localhost:3000/labs/<labId>/model-configs \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"name":"Mock A","provider":"mock","model":"mock-a","apiKey":"sk-demo-alpha"}'

# 列出实验室的模型配置（redacted）/ 按 ID 查询
curl http://localhost:3000/labs/<labId>/model-configs -H "X-User-Id: user-1"
curl http://localhost:3000/model-configs/<modelConfigId> -H "X-User-Id: user-1"

# 切换 / 清空密钥、停用配置
curl -X PATCH http://localhost:3000/model-configs/<modelConfigId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"apiKey":"sk-new"}'          # 替换密钥
curl -X PATCH http://localhost:3000/model-configs/<modelConfigId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"apiKey":null}'              # 清空密钥
curl -X PATCH http://localhost:3000/model-configs/<modelConfigId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"isEnabled":false}'          # 停用

# 测试模型网关（mock 返回确定性内容；不可达 Provider → 502 PROVIDER_ERROR + category）
curl -X POST http://localhost:3000/model-configs/<modelConfigId>/test -H "X-User-Id: user-1"

# 把 Alice 绑定 / 切换到某个模型配置（身份与记忆不受影响）
curl -X PATCH http://localhost:3000/agents/<agentId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"modelConfigId":"<modelConfigId>"}'

# 让 Alice 执行一次有界任务（SPEC-006；任务需先指派给 Alice 并推进到 running）
# 成功 → run.status=succeeded，任务完成；原始文本/供应商失败 → run.status=retryable，任务不动
curl -X POST http://localhost:3000/agents/<agentId>/runs \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"taskId":"<taskId>","instruction":"梳理证据并给出结构化结论","maxTokens":2048}'

# 查看 Alice 的全部运行（最新在前）/ 按 ID 查询一次运行
curl http://localhost:3000/agents/<agentId>/runs -H "X-User-Id: user-1"
curl http://localhost:3000/runs/<runId> -H "X-User-Id: user-1"

# 给 Alice 写入一条 Agent 私有记忆（作者恒为发起请求的 PI，服务端写入）
curl -X POST http://localhost:3000/labs/<labId>/memory \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"scope":"agent","scopeId":"<aliceAgentId>","content":"Alice 偏好用表格整理证据","importance":5}'

# 给当前 Project 写入一条项目记忆（后续该项目的任务会把它带进 Agent 提示词）
curl -X POST http://localhost:3000/labs/<labId>/memory \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"scope":"project","scopeId":"<projectId>","content":"本调查聚焦工作记忆容量（working memory capacity）"}'

# 写入一条实验室共享记忆（lab 作用域不携带 scopeId）
curl -X POST http://localhost:3000/labs/<labId>/memory \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"scope":"lab","content":"实验室政策：一律引用来源"}'

# 列出实验室的全部记忆（最新在前），可按作用域过滤
curl http://localhost:3000/labs/<labId>/memory -H "X-User-Id: user-1"
curl "http://localhost:3000/labs/<labId>/memory?scope=agent" -H "X-User-Id: user-1"

# 语义检索（v0.1 为离线关键词打分；索引策略抛错时自动回退，fallback=true）
curl "http://localhost:3000/labs/<labId>/memory/search?q=working+memory" -H "X-User-Id: user-1"

# 产物（SPEC-008）：成功运行后，run.result.artifact_proposals[].id 就是创建出的 Artifact id
# 列出某 Project 的全部产物（最新在前）/ 按 ID 读取一个产物
curl http://localhost:3000/projects/<projectId>/artifacts -H "X-User-Id: user-1"
curl http://localhost:3000/artifacts/<artifactId> -H "X-User-Id: user-1"

# 修订产物 → 生成下一个版本（version+1 的兄弟行，metadata.sourceArtifactId 指向原版）
curl -X POST http://localhost:3000/artifacts/<artifactId>/revisions \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"content":"修订版：新增 12 篇 2024 年文献","type":"report","title":"证据地图 v2"}'

# 组会（SPEC-009）：为 Project 创建组会，Alice + Bob 出席
# 创建时即确定性组装各自的进展汇报（基于该项目里他们的当前 Task / Artifact，验收 #2）
curl -X POST http://localhost:3000/projects/<projectId>/meetings \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"title":"证据综述推进同步","agenda":"确定下一阶段的优先产出","participantAgentIds":["<aliceAgentId>","<bobAgentId>"]}'

# 列出该 Project 的组会（最新在前）/ 查看一次组会的完整结构化结果
curl http://localhost:3000/projects/<projectId>/meetings -H "X-User-Id: user-1"
curl http://localhost:3000/meetings/<meetingId> -H "X-User-Id: user-1"

# 开始讨论（scheduled → in_progress，记录 startedAt）/ 记录讨论转录
curl -X POST http://localhost:3000/meetings/<meetingId>/start -H "X-User-Id: user-1"
curl -X PATCH http://localhost:3000/meetings/<meetingId> \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"transcript":"Alice 汇报证据地图，Bob 补充统计方案…"}'

# PI 记录决策（madeByType=pi / madeById=发起请求的用户，服务端写入，验收 #3）
curl -X POST http://localhost:3000/meetings/<meetingId>/decisions \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"statement":"下一阶段优先产出证据综述初稿","rationale":"证据基础偏薄"}'

# 记录行动项并一键生成后续任务（幂等；任务落在组会所属 Project 并回填 task_id，验收 #4）
curl -X POST http://localhost:3000/meetings/<meetingId>/action-items \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"title":"起草证据综述初稿","assigneeAgentId":"<aliceAgentId>"}'
curl -X POST http://localhost:3000/meetings/<meetingId>/action-items/<actionItemId>/tasks -H "X-User-Id: user-1"

# 完成组会 → 写入 Project 与 Lab 两级记忆（sourceType=meeting，验收 #5），返回结构化记录
curl -X POST http://localhost:3000/meetings/<meetingId>/complete -H "X-User-Id: user-1"

# PI 仪表盘（SPEC-010）：打开即看，无需输入。GET / 直接 302 到第一个 Lab 的仪表盘
# 浏览器访问（Accept: */* 或 text/html）→ 服务端渲染的 HTML 页
curl http://localhost:3000/labs/<labId>/dashboard -H "X-User-Id: user-1"

# 客户端访问（Accept: application/json）→ 同一份规范 LabDashboard JSON
curl http://localhost:3000/labs/<labId>/dashboard -H "X-User-Id: user-1" -H "Accept: application/json"

# 反向示例：跨 Lab 指派 → 403；非法迁移（backlog → completed）→ 400；伪造 creator → 400
curl -X POST http://localhost:3000/labs/<labId>/projects \
  -H "X-User-Id: user-1" -H "Content-Type: application/json" \
  -d '{"title":"非法","stage":"brainstorm"}'

# 反向示例：他人访问 → 403；空名称 → 400；无身份 → 401；未知 ID → 404；携带 api_key → 400
```

PowerShell 用户也可用 `Invoke-RestMethod`：

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/labs `
  -Headers @{ "X-User-Id" = "user-1" } `
  -ContentType "application/json" `
  -Body '{"name":"认知科学实验室"}'
```

---

## 6. 持久化与配置

| 环境变量 | 默认值 | 说明 |
| -------- | ------ | ---- |
| `PORT` | `3000` | HTTP 监听端口 |
| `DATABASE_PATH` | `./data/minilab.db` | SQLite 数据库文件路径 |
| `MODEL_GATEWAY_KEY` | 自动生成 | 凭据加密主密钥（64 位十六进制，32 字节）。**不设置时**自动生成并存到
  `<DATABASE_PATH>.key` 文件（如 `data/minilab.db.key`）；设置了则优先使用，便于在多个进程/
  机器间共享同一把密钥 |

Windows 下设置环境变量再启动：

```bat
set PORT=8080
set DATABASE_PATH=D:\labs\mylab.db
set MODEL_GATEWAY_KEY=<64位十六进制>
npm start
```

> 强烈建议把 `*.key` 文件加入 `.gitignore`，不要把密钥文件提交到版本库。
> 密钥文件被删除会导致已加密的 Provider 凭据无法解密（需重新配置 `apiKey`）。

**验证持久化**：创建 Lab → `Ctrl+C` 停掉服务 → 再次 `npm start` →
`GET /labs` 仍能看到之前创建的 Lab。模型配置同理：重启后
`POST /model-configs/:id/test` 仍能成功（证明加密凭据跨重启可解密）。

---

## 7. 运行测试

```bash
npm test
```

或双击 **`test.bat`**。测试覆盖：

- 领域单元测试（实体、校验、时间戳）；
- 服务层测试（所有权、增删改查）；
- 持久化集成测试（迁移幂等、数据库重开后数据仍在）；
- HTTP 契约测试（每个接口的 200/400/401/403/404 行为）；
- E2E 验收测试（创建 → 重启 → 取回）。

当前结果：**353/353 通过**，全程无需任何真实模型 Provider（网关测试用 mock 适配器、
必然不可达的本地端口与本地「原始文本」桩，完全离线、确定性）。

---

## 8. 验收标准对照

### SPEC-001（Lab Core）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | 创建返回持久 Lab ID | `POST /labs` → `201` 返回 `lab.id` |
| 2 | 应用重启后仍可取回 | `npm run demo` 的「重启」段落，或第 6 节手动验证 |
| 3 | 其他用户不可读写 | 跨用户 GET/PATCH → `403 FORBIDDEN` |
| 4 | 拒绝空名称 | 空 / 纯空白名称 → `400 VALIDATION_ERROR` |
| 5 | 测试无需真实模型 Provider | 全部测试离线运行 |

### SPEC-002（Agent Core）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | 雇佣返回持久 `agent_id` | `POST /labs/:labId/agents` → `201` 返回 `agent.id` |
| 2 | Agent 跨重启存活 | `npm run demo` 的「重启」段落：重启后 Alice 仍可取回 |
| 3 | Agent 归属唯一 Lab | 创建时只绑定一个 `labId`，接口校验 `labId` 必须存在 |
| 4 | 跨 Lab 访问被拒绝 | 他人 `GET/PATCH /agents/:agentId` → `403 FORBIDDEN` |
| 5 | Provider 密钥不进 Agent 行 | 请求体携带 `api_key` → `400`；`agents` 表无任何密钥列 |
| 6 | 停用不删除历史 | `PATCH status=inactive` 后记录仍在，可继续查询 |

### SPEC-003（Project System）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | Project 跨重启持久化 | `npm run demo` 的「重启」段落：重启后 Project 仍可取回，标题与 ID 不变 |
| 2 | stage 必须是受支持的 ResearchStage | `POST/PATCH` 传 `stage: "brainstorm"` 等非法值 → `400 VALIDATION_ERROR` |
| 3 | 跨 Lab 访问被拒绝 | 他人 `GET/PATCH /projects/:projectId` → `403 FORBIDDEN` |
| 4 | objective 变更记录更新时间戳 | `PATCH` 修改 objective 后，`updatedAt` 被更新并持久化（只增不减） |

### SPEC-004（Task System）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | PI 可把 Task 指派给 Alice | `POST /projects/:projectId/tasks`（带 `assigneeAgentId`）→ `201` 返回 `task.id`，`assigneeAgentId` 为 Alice |
| 2 | Task 跨重启仍与 Alice 关联 | `npm run demo` 的「重启」段落：重启后 `GET /tasks/:taskId` 仍返回同一指派与状态 |
| 3 | 指派者必须与 Project 同 Lab | 指派其他 Lab 的 Agent → `403 FORBIDDEN` |
| 4 | 非法状态迁移被拒绝 | `PATCH { "status": "completed" }`（从 `backlog`）→ `400 VALIDATION_ERROR` |
| 5 | 完成不删除历史 | 走合法链路到 `completed` 后，标题 / 描述 / 指派全部保留，记录仍可查询 |

### SPEC-005（Model Gateway）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | Agent Runtime 通过 ModelGateway 调用模型，而非直接调 Provider SDK | 唯一的模型调用入口是 `ModelGateway` 接口；本版本由 `POST /model-configs/:modelConfigId/test` 走同一网关演示，`MockProviderAdapter` 全程零网络 |
| 2 | 领域/应用层不 import Provider SDK 响应类型 | 代码无任何 Provider SDK 依赖（工作适配器用原生 `fetch`），输出统一为 `ModelResponse` |
| 3 | mock Provider 可驱动确定性测试 | `npm test` 全程离线；网关返回固定内容，测试可脚本化成功/失败 |
| 4 | Provider 失败返回归一化错误分类 | 连不可达端口 → `502 PROVIDER_ERROR` + `category: "connection_failed"`（`npm run demo` 有该段落） |
| 5 | 密钥不写入日志 | `apiKey` 仅经 `POST/PATCH /model-configs` 的显式字段入库；响应、列表、错误信息均无明文/密文；`console.error` 只打网关的归一化消息 |
| 6 | 切换 Provider 配置不改变 Agent 身份或记忆 | `PATCH /agents/:agentId { "modelConfigId": <new> }` 后，name/role/lab/status 全不变，`modelConfigId` 更新并跨重启持久化 |

### SPEC-006（Agent Runtime）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | 原始未校验文本不能改变持久状态 | 让模型返回普通文本 → `POST /agents/:agentId/runs` 产生 `retryable/schema`，`result=null`，`GET /tasks/:taskId` 状态分毫不动（`npm run demo` 的「原始文本不能改变状态」段落用本地桩演示） |
| 2 | schema 失败标记为可重试失败 | 上一条的运行 `status=retryable`、`errorCategory=schema`，且 Run 落库可追踪 |
| 3 | 供应商失败不破坏任务状态 | 把 Agent 切到「必然不可达」的配置再运行 → `retryable/provider`，任务保持原状（`npm run demo` 有该段落） |
| 4 | 运行元数据关联 Agent、Project、Task 与 Provider/模型引用 | 成功运行 `run.agentId/projectId/taskId/modelConfigId/provider/model` 全被填充并跨重启持久化（`GET /runs/:runId`） |
| 5 | 建议任务保持为提案 | 成功运行后 `result.suggested_tasks` / `memory_candidates` 在 Run 里记录，但 Project 下**没有**新增任何 Task 实体（`artifact_proposals` 例外：由 SPEC-008 实体化为 Artifact） |

### SPEC-007（Persistent Scoped Memory）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | Alice 取回自己的 Agent 记忆 | `POST /labs/:labId/memory` 写入 Alice 作用域记忆后，让 Alice 跑一次任务，系统提示词含该记忆（`npm run demo` 的「记忆进入 Agent 提示词」段落） |
| 2 | Bob 读不到 Alice 的私有记忆 | 同 Lab 内 Bob 的私有记忆不出现在 Alice 的提示词中（e2e 断言 `doesNotMatch`）；他人访问记忆接口 → `403` |
| 3 | 后续项目任务可取回 Project 记忆 | 同一 Project 的后续任务（含重启后的任务）提示词里仍带该 Project 记忆 |
| 4 | 重启后记忆仍可取回 | `npm run demo` 的「重启」段落：重启后 SPEC-007 的 4 条记忆仍在（SPEC-009 组会完成又写入 2 条，共 6 条），`/search` 正常 |
| 5 | 暴露来源类型与来源 ID | 记忆行与响应携带 `sourceType` / `sourceId`，提示词以 `by pi:user-1` 渲染溯源 |
| 6 | 语义索引失败不擦除规范记忆 | 索引策略抛错时 `/search` 返回 `fallback: true` + 基于作用域的候选，`memories` 表原样保留 |

### SPEC-008（Artifacts）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | 一次完成的 Agent 运行能创建 Artifact | 让 Alice 跑一次成功任务 → `run.result.artifact_proposals[].id` 出现，`GET /projects/:projectId/artifacts` 能列出（`npm run demo` 的 SPEC-008 段落） |
| 2 | 重启后 Artifact 仍可取回 | `npm run demo` 的「重启」段落：重启后按 ID 读取 Artifact 与修订版均 200 |
| 3 | Artifact 关联其 Project | Artifact 行携带 `projectId`，按 Project 列表可取回；跨 Lab 的 PI 读取 → `403` |
| 4 | 版本元数据被保留 | `version` 从 1 起；`POST /artifacts/:id/revisions` 生成 `version+1` 的兄弟行并记录 `metadata.sourceArtifactId`，重启后仍在 |
| 5 | 转录文本不是唯一存储位置 | Artifact 内容存储在 `artifacts` 表的 `content` 列，按 ID / 按 Project 均可取回，独立于 Run 转录 |

### SPEC-009（Group Meeting）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | 组会可以包含 Alice、Bob 与一个 Project | `POST /projects/:projectId/meetings`（`participantAgentIds` 填 Alice 与 Bob）→ `201`；`GET /meetings/:meetingId` 的 `participants` 长度为 2，`projectId` 唯一 |
| 2 | 参与者进展锚定其当前任务/产物 | 创建组会后 `updates[]` 里 Alice 的 `content` 来自她当前 Task / Artifact（`taskIds` / `artifactIds` 数组），**确定性组装、不调用模型**（`npm run demo` 的 SPEC-009 段落直接断言内容） |
| 3 | PI 可以记录决策 | `POST /meetings/:meetingId/decisions` → `201`，`madeByType: "pi"`、`madeById` = 发起用户（服务端写入；请求体伪造 → `400`） |
| 4 | 行动项可以生成后续任务 | `POST .../action-items/:id/tasks` → `201 { task, actionItem }`；任务落在组会所属 Project、指派给行动项指派人、`task_id` 回填、`resultingTaskIds` 暴露；重复调用幂等（`npm run demo` 的 SPEC-009 段落） |
| 5 | 组会完成把结果写入 Project/Lab 记忆并带出处 | `POST /meetings/:meetingId/complete` 后记忆列表出现 `sourceType: "meeting"`、`sourceId` = 组会 id 的两条（project + lab 作用域），`memoryWriteIds` 为 2；重复完成不重复写入 |
| 6 | 完成态不是只有转录 | 完成响应与 `GET /meetings/:meetingId` 返回结构化 `MeetingDetail`（参与者/进展/决策/行动项/后续任务 id/记忆 id）；终态不可变（之后记录决策 → `400`）；`npm run demo` 的「重启」段落验证全部跨重启保留 |

### SPEC-010（PI Dashboard）

| # | 验收标准 | 如何验证 |
| - | -------- | -------- |
| 1 | 打开即知实验室正在发生什么，无需先发消息 | `GET /` → `302` 到第一个 Lab 的仪表盘；`GET /labs/:labId/dashboard`（默认 HTML）展示进行中的项目（阶段/状态）、成员名册、需要关注的任务、等待的问题、最近产物/决策、组会入口（`npm run demo` 的 SPEC-010 段落直接断言页面内容） |
| 2 | 被阻塞的任务可见，无需打开对话 | 让一次运行返回 `task_status: blocked` → 任务出现在仪表盘的 `attentionTasks`（HTML「受阻」徽章 / JSON feed）；`npm run demo` 用本地受阻桩演示 |
| 3 | 等待 PI 的问题可见 | 同一个受阻运行携带 `questions_for_pi` → 问题出现在「等待你的问题」；规则：每个未终结任务取**最近一次成功运行**的问题（更新的运行覆盖、无问题则清空、终结任务视为已解决） |
| 4 | Agent 是持久身份，视觉上与临时对话参与者区分 | 成员以身份卡片渲染（`data-agent-id`、角色/专长/状态、标注「持久实验室成员」），绝不渲染成聊天消息 |
| 5 | 仪表盘基于规范领域状态，而非 LLM 摘要 | `DashboardService` 确定性组合既有仓储行；服务仪表盘**无任何模型调用**——读取前后 run 数不变（`npm run demo` 的「验收 #5」段落证明） |

---

## 9. 常见问题（FAQ）

**Q：双击 `start.bat` 提示找不到 Node.js？**
先到 https://nodejs.org/ 安装 Node.js 20+，安装后重新打开命令行再试。

**Q：端口被占用？**
设置 `PORT` 环境变量换一个端口，或先结束占用端口的进程。

**Q：`npm install` 很慢或失败？**
多为网络原因，可换用镜像源：`npm install --registry=https://registry.npmmirror.com`。

**Q：`data/` 目录不存在？**
首次启动会自动创建（含父目录）。

**Q：想换 PostgreSQL？**
本版本基于关系型 SQLite（满足 ADR-0001）。仓库通过 `LabRepository` 等仓储接口隔离
存储实现，后续接入 PostgreSQL 只需新增实现类，无需改动领域层。

**Q：`MODEL_GATEWAY_KEY` 该填什么？**
64 个十六进制字符（32 字节），例如 `openssl rand -hex 32` 的输出。**不填也能跑**：系统会
自动生成一个 `<db>.key` 文件并把密钥存进去，重启仍可解密；只要别删掉那个文件。

**Q：为什么 `/model-configs/:id/test` 连不上会返回 502？**
因为那是**归一化的 Provider 错误**（`PROVIDER_ERROR`），属于可预期的外部失败而非系统
BUG，所以不按 500 处理——SPEC-006 的 Agent Runtime 已经这样消费它：运行任务时供应商连
不上会产生 `retryable/provider` 的 Run（任务状态不被污染），上层可据此重试或换 Provider，
而不是误判为内部故障。

**Q：一次 Agent 运行（`POST /agents/:agentId/runs`）为什么失败也会返回 201？**
因为 Run 本身是**创建出来的资源**：每次执行尝试（无论成败）都要落一条可追踪的记录
（验收 #4）。失败信息在 `run.status`/`run.errorCategory` 里，而不是 HTTP 错误码。

**Q：Agent 返回普通文本会怎样？**
会被类型化 schema 拒绝：产生 `retryable/schema` 的 Run，`result=null`，任务状态分毫不动
（验收 #1/#2）。模型输出只有在通过严格校验、且提议的状态迁移合法时，才会被应用到任务。

**Q：组会里 Alice/Bob 的"进展汇报"是怎么来的？会不会调用模型？**
不会调用模型（SPEC-009 验收 #2，规则 18）。创建组会时由服务端**确定性**地组装：取
`assigneeAgentId` = 该 Agent 的 Task 行与 `creatorAgentId` = 该 Agent 的 Artifact 行
（都在组会所属 Project 内），拼成如 `Tasks: '…' (…). Artifacts: …` 的文本，并附
`taskIds` / `artifactIds` 数组。所以"进展锚定当前工作"是**可测试**的——`npm run demo`
的 SPEC-009 段落直接断言了这条内容。

**Q：组会完成了还能再记决策或追加行动项吗？**
不能。`completed` 是**终态且不可变**：之后再调用 `/decisions`、`/action-items` 或
`PATCH /meetings/:id` 一律 `400 VALIDATION_ERROR`。行动项要生成后续任务，必须在完成前
调用 `/action-items/:id/tasks`（该调用本身也是幂等的）。

**Q：组会完成时写的记忆在哪？为什么组会结果里没有直接存记忆内容？**
完成时经 `MemoryService` 写入两条记忆：`scope: "project"` + `scope: "lab"`，出处
`sourceType: "meeting"` / `sourceId: <组会 id>`（规则 17：记忆保留出处）。记忆 id 通过
出处从记忆仓库**取回**（`memoryWriteIds`），不在组会行上冗余——记忆是检索导向的知识，
事实（决策、行动项、后续任务）仍留在各自表里。

**Q：PI 仪表盘会调用模型吗？为什么打开页面那么快？**
不会（SPEC-010 验收 #5，ADR-0006）。`DashboardService` 只是**确定性组合**规范领域行
（projects / agents / tasks / runs / artifacts / meetings / decisions），不经过任何模型
调用——所以它天然很快、可测试、与 LLM 生成无关。`npm run demo` 的「验收 #5」段落直接
证明了读取两次仪表盘后 run 数不变。「等待你的问题」来自每个未终结任务**最近一次成功
运行**的 `questions_for_pi`，同样是读既有数据，不是现场问模型。

**Q：浏览器打开 `GET /labs/:labId/dashboard` 拿到的是 HTML，为什么带 `Accept:
application/json` 就变 JSON 了？**
内容协商（SPEC-010）：同一路由按 `Accept` 头返回两种表示——浏览器默认拿服务端渲染的
HTML 页（默认 UI），API 客户端拿同一份规范 `LabDashboard` JSON。两者内容同源，都按 Lab
归属鉴权。

---

## 10. 目录结构

```text
E:\MiniLab\
├── start.bat / test.bat     一键启动 / 一键测试（Windows）
├── package.json / tsconfig.json
├── src/
│   ├── domain/              Lab / Agent / Project / Task / ModelConfig / AgentRun / Memory / Meeting / Decision 实体、ModelRequest/ModelResponse 归一化类型、领域错误（纯逻辑，零依赖）
│   ├── application/         各 Service（所有权强制）+ 仓储接口 + ModelGateway + ProviderAdapter + SecretCipher + AgentRuntimeService + 结果 schema + MemoryService + MemorySearchStrategy + MeetingService + DashboardService
│   ├── infrastructure/db/   SQLite 连接、迁移（v1 labs … v9 meetings）、仓储实现
│   ├── infrastructure/models/  凭据加密（AES-256-GCM + 主密钥）+ 适配器（mock / openai_compatible）
│   ├── infrastructure/memory/  语义检索实现（v0.1 为离线关键词策略 KeywordMemorySearch）
│   └── api/                 路由（labs / agents / projects / tasks / model-configs / runs / memory / meetings / dashboard）、认证桩、错误映射、应用工厂
├── scripts/demo.mjs         端到端演示程序（Lab + Agent + Project + Task + Model Config + Agent Run + Memory + Meeting + PI Dashboard）
├── tests/                   单元 / 集成 / 契约 / E2E 测试
└── docs/USAGE.md            本文档
```
