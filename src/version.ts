/**
 * 单一版本来源。发布时与 package.json 的 version 同步递增（health 端点、CLI
 * --version、桌面版都从这里读）。独立成文件而不是 require package.json，
 * 是为了避开编译后（dist/src/api/）与打包后（pkg 快照）的相对路径差异。
 */
export const VERSION = '0.2.1';
