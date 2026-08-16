import express from 'express';

import { createApp } from './api/app';
import { AgentRuntimeService } from './application/agentRuntimeService';
import { AgentService } from './application/agentService';
import { ArtifactService } from './application/artifactService';
import { DashboardService } from './application/dashboardService';
import { LabPulseService } from './application/labPulseService';
import { LabService } from './application/labService';
import { MeetingService } from './application/meetingService';
import { MemoryService } from './application/memoryService';
import { KeywordMemorySearch } from './application/memorySearch';
import { ModelConfigService } from './application/modelConfigService';
import { ModelGatewayService, type ModelGateway } from './application/modelGateway';
import { ProjectService } from './application/projectService';
import { InMemorySessionStore, type SessionStore } from './application/sessionStore';
import { TaskService } from './application/taskService';
import { UserService } from './application/userService';
import { DashScopeVoiceService, type VoiceService } from './application/voiceService';
import { openDatabase, type MiniLabDb } from './infrastructure/db/database';
import { SqliteAgentRepository } from './infrastructure/db/sqliteAgentRepository';
import { SqliteAgentRunRepository } from './infrastructure/db/sqliteAgentRunRepository';
import { SqliteArtifactRepository } from './infrastructure/db/sqliteArtifactRepository';
import { SqliteDecisionRepository } from './infrastructure/db/sqliteDecisionRepository';
import { SqliteLabRepository } from './infrastructure/db/sqliteLabRepository';
import { SqliteMeetingRepository } from './infrastructure/db/sqliteMeetingRepository';
import { SqliteMemoryRepository } from './infrastructure/db/sqliteMemoryRepository';
import { SqliteModelConfigRepository } from './infrastructure/db/sqliteModelConfigRepository';
import { SqliteProjectRepository } from './infrastructure/db/sqliteProjectRepository';
import { SqliteTaskRepository } from './infrastructure/db/sqliteTaskRepository';
import { SqliteUserRepository } from './infrastructure/db/sqliteUserRepository';
import { OpenAICompatibleAdapter } from './infrastructure/models/adapters/openAiCompatibleAdapter';
import { MockProviderAdapter } from './infrastructure/models/adapters/mockProviderAdapter';
import { getOrCreateCredentialCipher } from './infrastructure/models/credentialCipher';

/** 可覆盖的启动参数。不传则回落到对应环境变量/默认值。 */
export interface MiniLabAppEnv {
  port?: number;
  host?: string;
  databasePath?: string;
  modelTimeoutMs?: number;
}

/** 装配完成后暴露给调用方（CLI 的 server.ts、Electron 主进程）的全套服务。 */
export interface MiniLabAppServices {
  labService: LabService;
  agentService: AgentService;
  projectService: ProjectService;
  taskService: TaskService;
  modelConfigService: ModelConfigService;
  modelGateway: ModelGateway;
  agentRuntime: AgentRuntimeService;
  memoryService: MemoryService;
  artifactService: ArtifactService;
  meetingService: MeetingService;
  dashboardService: DashboardService;
  labPulseService: LabPulseService;
  userService: UserService;
  sessionStore: SessionStore;
  voiceService: VoiceService;
}

export interface MiniLabApp {
  app: express.Express;
  db: MiniLabDb;
  port: number;
  host: string;
  databasePath: string;
  services: MiniLabAppServices;
}

/**
 * 装配一个完整的 MiniLab Express 应用：打开 SQLite → 构造 repository/service →
 * createApp。**不 `listen`**——监听端口由调用方决定（CLI 的 server.ts、Electron
 * 主进程各自监听）。
 *
 * 与旧 server.ts 的差异：env 参数优先，其次环境变量，最后默认值：
 *   port         默认 3000（$PORT）
 *   host         默认 127.0.0.1（$HOST）
 *   databasePath 默认 ./data/minilab.db（$DATABASE_PATH）
 *   modelTimeoutMs 默认 120_000（$MINILAB_MODEL_TIMEOUT_MS）
 *
 * 身份模型：浏览器走 cookie session（登录后 Set-Cookie minilab_session；进程重启即
 * 会话失效，每次打开需重新输入密码）；本地 CLI/脚本继续携带 x-user-id 头（SPEC-001
 * 契约不变，见 src/api/auth.ts）。首次启动 users 表为空 → /setup 引导创建 0 号用户，
 * 并把旧 local-pi 名下数据迁移给该用户。
 */
export function createMiniLabApp(env: MiniLabAppEnv = {}): MiniLabApp {
  if (process.env.MINILAB_DESKTOP !== '0') process.env.MINILAB_DESKTOP = '1';

  const port = env.port ?? Number(process.env.PORT ?? 3000);
  // 默认只绑 127.0.0.1：本地单机工具不该被局域网里的其它设备访问（认证是无信任的
  // X-User-Id 头，绑定到所有网卡等于把 PI 的实验室数据暴露给邻居）。需要对外暴露
  // 时显式设 HOST=0.0.0.0（或 --host 0.0.0.0）。
  const host = env.host ?? process.env.HOST ?? '127.0.0.1';
  const databasePath = env.databasePath ?? process.env.DATABASE_PATH ?? './data/minilab.db';

  const db = openDatabase(databasePath);
  const labRepository = new SqliteLabRepository(db);
  const agentRepository = new SqliteAgentRepository(db);
  const projectRepository = new SqliteProjectRepository(db);
  const labService = new LabService(labRepository);
  const agentService = new AgentService(agentRepository, labRepository);
  const projectService = new ProjectService(projectRepository, labRepository);
  const taskService = new TaskService(
    new SqliteTaskRepository(db),
    projectRepository,
    agentRepository,
    labRepository,
  );
  const modelConfigService = new ModelConfigService(
    new SqliteModelConfigRepository(db),
    labRepository,
    getOrCreateCredentialCipher(process.env.MODEL_GATEWAY_KEY, `${databasePath}.key`),
  );
  const modelTimeoutMs = env.modelTimeoutMs ?? Number(process.env.MINILAB_MODEL_TIMEOUT_MS ?? 120_000);
  const modelGateway = new ModelGatewayService({
    openai_compatible: new OpenAICompatibleAdapter(Number.isFinite(modelTimeoutMs) ? modelTimeoutMs : 120_000),
    mock: new MockProviderAdapter(),
  });
  const memoryService = new MemoryService(
    new SqliteMemoryRepository(db),
    labRepository,
    agentRepository,
    projectRepository,
    new KeywordMemorySearch(),
  );
  const artifactService = new ArtifactService(
    new SqliteArtifactRepository(db),
    projectRepository,
    labRepository,
  );
  const meetingService = new MeetingService(
    new SqliteMeetingRepository(db),
    new SqliteDecisionRepository(db),
    projectRepository,
    labRepository,
    agentRepository,
    new SqliteTaskRepository(db),
    new SqliteArtifactRepository(db),
    taskService,
    memoryService,
  );
  const agentRuntime = new AgentRuntimeService(
    agentRepository,
    labRepository,
    projectRepository,
    new SqliteTaskRepository(db),
    taskService,
    modelConfigService,
    modelGateway,
    new SqliteAgentRunRepository(db),
    memoryService,
    artifactService,
  );
  const dashboardService = new DashboardService(
    labRepository,
    agentRepository,
    projectRepository,
    new SqliteTaskRepository(db),
    new SqliteArtifactRepository(db),
    new SqliteMeetingRepository(db),
    new SqliteDecisionRepository(db),
    new SqliteAgentRunRepository(db),
  );
  const labPulseService = new LabPulseService(labService, dashboardService);
  const userRepository = new SqliteUserRepository(db);
  const userService = new UserService(userRepository, labRepository);
  const sessionStore = new InMemorySessionStore();
  const voiceService = new DashScopeVoiceService(modelConfigService);
  const services: MiniLabAppServices = {
    labService,
    agentService,
    projectService,
    taskService,
    modelConfigService,
    modelGateway,
    agentRuntime,
    memoryService,
    artifactService,
    meetingService,
    dashboardService,
    labPulseService,
    userService,
    sessionStore,
    voiceService,
  };
  const app = createApp({ ...services, dataDir: databasePath, port });

  return { app, db, port, host, databasePath, services };
}
