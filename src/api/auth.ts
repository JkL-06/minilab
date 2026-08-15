import type { NextFunction, Request, Response } from 'express';

/**
 * Authentication stub for SPEC-001.
 *
 * There is no auth spec yet, so the "authenticated user" (MVP.md) is the value
 * of the `X-User-Id` header. Requests without one are rejected as
 * unauthenticated. Lab ownership is then enforced against this ID in the
 * service layer.
 */
export const USER_ID_HEADER = 'x-user-id';

/**
 * 启动器（bin/minilab.js，即 `npx minilab` 与桌面版 exe 的共同入口）专用浏览器
 * 回退。产品承诺「打开网页即是 PI 仪表盘」：启动后浏览器访问 `http://localhost:PORT/`
 * 是纯导航，浏览器无法携带 `x-user-id` 头，任何路由的 `requireUser` 都会直接 401
 * （这就是桌面版打开即报 UNAUTHENTICATED 的根源）。本中间件挂在 app 最顶层
 * （所有路由之前）：把「启动器模式下、没有 x-user-id 头、且 Accept 显式含
 * text/html 的普通浏览器请求」认作本地单机用户 `local-pi`（填入请求头），之后
 * 所有路由的 `requireUser` 都能通过。
 *
 * 仅在 `MINILAB_DESKTOP=1`（由 bin/minilab.js 设置，npx 与 pkg 打包都生效）时
 * 开启；直接 `node dist/src/server.js`（源码/开发）不开启。Accept 不显式含
 * text/html 的请求（curl 默认的通配 Accept、API/JSON 客户端）依旧必须携带
 * x-user-id，SPEC-001 契约不变（Lab 归属校验也原样生效）。
 */
export const DESKTOP_BROWSER_USER_ID = 'local-pi';

export function desktopBrowserFallback(req: Request, _res: Response, next: NextFunction): void {
  // 仅当 Accept 显式包含 text/html 才认为是「普通浏览器导航」。curl 等客户端
  // 默认 Accept: */* 不会被误判，API/JSON 客户端依旧必须携带 x-user-id。
  const accept = String(req.header('accept') ?? '');
  if (
    process.env.MINILAB_DESKTOP === '1' &&
    !req.header(USER_ID_HEADER) &&
    accept.includes('text/html')
  ) {
    req.headers[USER_ID_HEADER] = DESKTOP_BROWSER_USER_ID;
  }
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = req.header(USER_ID_HEADER);
  if (!userId || userId.trim().length === 0) {
    res.status(401).json({
      error: { code: 'UNAUTHENTICATED', message: `Missing or empty ${USER_ID_HEADER} header` },
    });
    return;
  }
  req.userId = userId;
  next();
}

/**
 * 桌面版跨站请求伪造（CSRF）防护。挂在 desktopBrowserFallback 之后、所有路由
 * 之前，只作用于「启动器模式（MINILAB_DESKTOP=1）+ 状态变更方法 + 无 x-user-id
 * 头」的请求——也就是会走浏览器回退、被当作本地用户 local-pi 的那类请求。
 *
 * 风险场景：本地桌面版绑定在 127.0.0.1 后，恶意网页仍可能用表单/脚本向
 * `http://localhost:3000` 发跨站 POST，浏览器会自动带上 Accept: text/html 且
 * 无法自定义 x-user-id 头，于是 fallback 会把它当成 local-pi 放行。本守卫用
 * Origin/Referer 与请求 Host 比对，跨源一律 403，同源（用户自己打开的本地页面）
 * 正常放行。GET 不在此列：跨站 GET 无法读取响应（无 CORS 头），无副作用。
 */
export function desktopCsrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (process.env.MINILAB_DESKTOP !== '1') {
    next();
    return;
  }
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    next();
    return;
  }
  // 已携带 x-user-id 的请求走 SPEC-001 认证契约，不经过浏览器回退，无需守卫。
  if (req.header(USER_ID_HEADER)) {
    next();
    return;
  }
  const host = req.headers.host;
  const origin = req.header('origin');
  if (origin) {
    if (host && originHostOf(origin) !== host) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-site request rejected' } });
      return;
    }
    next();
    return;
  }
  const referer = req.header('referer');
  if (referer) {
    if (host && originHostOf(referer) !== host) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cross-site request rejected' } });
      return;
    }
  }
  next();
}

/** Extracts the `host[:port]` from an absolute URL; returns '' on malformed input. */
function originHostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}
