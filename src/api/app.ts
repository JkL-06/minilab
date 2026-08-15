import express from 'express';

import type { AgentRuntimeService } from '../application/agentRuntimeService';
import type { AgentService } from '../application/agentService';
import type { ArtifactService } from '../application/artifactService';
import type { DashboardService } from '../application/dashboardService';
import type { LabService } from '../application/labService';
import type { MeetingService } from '../application/meetingService';
import type { MemoryService } from '../application/memoryService';
import type { ModelConfigService } from '../application/modelConfigService';
import type { ModelGateway } from '../application/modelGateway';
import type { ProjectService } from '../application/projectService';
import type { TaskService } from '../application/taskService';
import { desktopBrowserFallback, desktopCsrfGuard } from './auth';
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
import { taskRouter } from './taskRoutes';
import { uiRouter } from './uiRoutes';
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
}: ApiDeps): express.Express {
  const app = express();
  app.use(express.json());
  // HTML 表单（页面内操作）用 application/x-www-form-urlencoded 提交。
  app.use(express.urlencoded({ extended: false }));
  // 跨站请求防护必须在浏览器回退之前：回退会先给请求填上 x-user-id，若守卫在
  // 其后运行就会看到「已有身份头」而永远跳过，跨站表单攻击因此不会被拦截。
  // 守卫只拦「无 x-user-id 的状态变更请求」——这类请求正是会走回退的那类。
  app.use(desktopCsrfGuard);
  // 桌面版浏览器回退必须在所有路由之前：它只负责给「普通浏览器（Accept:
  // text/html，无 x-user-id）」请求填上本地用户头，之后每个路由的 requireUser
  // 才能通过。npm/源码模式下该中间件是空操作。
  app.use(desktopBrowserFallback);
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
  };
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
  app.use(dashboardRouter(dashboardService, labService, modelConfigService));
  app.use(errorHandler);
  return app;
}
