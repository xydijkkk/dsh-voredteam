// 合集入口包（cordis 插件名 = 包名去掉 scope，见 cordis.patch.yml）。
// 每个会话实际加载的是 plugins/vore-* 四个子插件；这个入口只保证包本身可被加载。
export const name = "dsh-voredteam";
export const inject = [];
export function apply() {}
