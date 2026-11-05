/** 用户可见产品主名（窗口、登录、侧栏、关于页等） */
export const PRODUCT_NAME = "YunTu Control";

/** 登录页、欢迎页副标题 */
export const PRODUCT_TAGLINE = "本机办事工作台";

/**
 * 内部代号：包标识、数据目录、User-Agent、日志前缀等。
 * 勿在 UI 中直接展示。
 */
export const PRODUCT_CODE_NAME = "YunTuAI";

/** Agent 会话约定前缀（注入首轮用户消息，不写入 SQLite） */
export const PRODUCT_IDENTITY_LABEL = `${PRODUCT_NAME}·会话约定`;
