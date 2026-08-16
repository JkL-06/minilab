import express from 'express';

import type { AgentRuntimeService } from '../application/agentRuntimeService';
import type { AgentService } from '../application/agentService';
import type { ArtifactService } from '../application/artifactService';
import type { DashboardService } from '../application/dashboardService';
import { LabPulseService } from '../application/labPulseService';
import type { LabService } from '../application/labService';
import type { MeetingService } from '../application/meetingService';
import type { MemoryService } from '../application/memoryService';
import type { ModelConfigService } from '../application/modelConfigService';
import type { ModelGateway } from '../application/modelGateway';
import type { ProjectService } from '../application/projectService';
import type { SessionStore } from '../application/sessionStore';
import type { TaskService } from '../application/taskService';
import type { UserService } from '../application/userService';
import type { VoiceService } from '../application/voiceService';
import { desktopCsrfGuard, sessionAuth } from './auth';
import { authRouter } from './authRoutes';
import { agentRunRouter } from './agentRunRoutes';
import { agentRouter } from './agentRoutes';
import { artifactRouter } from './artifactRoutes';
import { dashboardRouter } from './dashboardRoutes';
import { errorHandler } from './errors';
import { labRouter } from './labRoutes';
import { meetingRouter } from './meetingRoutes';
import { memoryRouter } from './memoryRoutes';
import { modelConfigRouter } from './modelConfigRoutes';
import { projectRouter } from './projectRoutes';
import { settingsRouter } from './settingsRoutes';
import { taskRouter } from './taskRoutes';
import { uiRouter } from './uiRoutes';
import { voiceRouter } from './voiceRoutes';
import { VERSION } from '../version';

export interface ApiDeps {
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
  /** 可选：默认在 createApp 内以 (LabService, DashboardService) 构造，
   *  让测试 harness 不必为 23 个 createApp 调用点补齐依赖。 */
  labPulseService?: LabPulseService;
  userService: UserService;
  sessionStore: SessionStore;
  voiceService: VoiceService;
  /** Runtime info surfaced in the settings 常规 tab (optional; absent in tests). */
  dataDir?: string;
  port?: number;
}

/**
 * Builds the Express application. Dependencies are injected so tests can
 * supply in-memory or temp-file-backed services without starting a server.
 */
export function createApp({
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
  dataDir,
  port,
}: ApiDeps): express.Express {
  // 测试 harness 常不传 labPulseService——用最小依赖构造一个默认实现。
  const pulse = labPulseService ?? new LabPulseService(labService, dashboardService);
  const app = express();
  app.use(express.json());
  // HTML 表单（页面内操作）用 application/x-www-form-urlencoded 提交。
  app.use(express.urlencoded({ extended: false }));
  // 会话解析：请求带合法 minilab_session cookie 时在 req.sessionUserId 上记录用户。
  // 必须在所有 requireUser / authRouter 之前，进程重启即无会话（每次打开要密码）。
  app.use(sessionAuth(sessionStore));
  // 跨站请求防护：只拦「无 x-user-id 头的状态变更请求」，对比 Origin/Referer 与
  // Host。SameSite=Strict cookie 已阻断跨站 cookie 携带，这是纵深防御。
  app.use(desktopCsrfGuard);
  // 可选的单行请求日志（MINILAB_REQUEST_LOG=1 开启），供调试/运维用。
  if (process.env.MINILAB_REQUEST_LOG === '1') {
    app.use((req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }
  // 健康检查：本机进程存活 + 版本 + 运行时长。不要求认证（供脚本/监控探活）。
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION, uptimeMs: Math.round(process.uptime() * 1000) });
  });
  const deps = {
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
    userService,
    sessionStore,
    voiceService,
  };
  // 认证路由豁免 requireUser（登录/登出/状态/首次设置），挂其它 router 之前。
  app.use(authRouter({ userService, sessionStore }));
  // 浏览器 UI（HTML 详情页 + 表单操作）挂最前；非 text/html 请求直接 next()
  // 落回下方 JSON 路由，API 契约不变。
  app.use(uiRouter(deps));
  app.use(labRouter(labService));
  app.use(agentRouter(agentService));
  app.use(projectRouter(projectService));
  app.use(taskRouter(taskService));
  app.use(modelConfigRouter(modelConfigService, modelGateway));
  app.use(agentRunRouter(agentRuntime));
  app.use(memoryRouter(memoryService));
  app.use(artifactRouter(artifactService));
  app.use(meetingRouter(meetingService));
  app.use(
    settingsRouter({
      userService,
      labService,
      modelConfigService,
      modelGateway,
      dataDir,
      port,
    }),
  );
  app.use(voiceRouter({ voiceService, userService }));
  app.use(
    dashboardRouter(dashboardService, labService, modelConfigService, userService, pulse),
  );
  app.use(errorHandler);
  return app;
}
