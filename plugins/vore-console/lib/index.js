// vore-console —— 作战面板（宿主侧为 no-op，界面全部在 lib/client.mjs）。
// 面板读的是黑板插件的 HTTP 通道 /vore-blackboard（同源 + CSRF），不需要宿主侧再开路由。
export const name = "vore-console";
export const inject = [];
export function apply() { /* 面板全在客户端 */ }
