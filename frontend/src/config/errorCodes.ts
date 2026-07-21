/** 与后端 app/core/codes.py 保持一致 */
export const ErrorCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1000,
  VALIDATION_ERROR: 1001,
  AUTH_FAILED: 2001,
  TOKEN_INVALID: 2002,
  PERMISSION_DENIED: 2003,
  RESOURCE_NOT_FOUND: 3001,
  TOOL_EXECUTION_ERROR: 4001,
  SKILL_EXECUTION_ERROR: 4002,
  EXTERNAL_SERVICE_ERROR: 5001,
} as const;

export const ErrorMessages: Record<number, string> = {
  [ErrorCode.GENERAL_ERROR]: "系统错误",
  [ErrorCode.VALIDATION_ERROR]: "参数校验失败",
  [ErrorCode.AUTH_FAILED]: "认证失败",
  [ErrorCode.TOKEN_INVALID]: "登录已过期，请重新登录",
  [ErrorCode.PERMISSION_DENIED]: "无权限访问",
  [ErrorCode.RESOURCE_NOT_FOUND]: "资源不存在",
  [ErrorCode.TOOL_EXECUTION_ERROR]: "Tool 执行失败",
  [ErrorCode.SKILL_EXECUTION_ERROR]: "Skill 执行失败",
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: "外部服务异常",
};

export function resolveErrorMessage(code: number, fallback?: string): string {
  return fallback || ErrorMessages[code] || "请求失败";
}
