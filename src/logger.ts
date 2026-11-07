import type { Context } from 'cordis'

/** 插件内的日志：`debugLogging` 打开时调试信息以 info 级别输出，否则走 logger 自己的 debug 级别。 */
export interface Logger {
  debug(format: string, ...args: unknown[]): void
  info(format: string, ...args: unknown[]): void
  warn(format: string, ...args: unknown[]): void
}

export function createLogger(ctx: Context, debugLogging: boolean): Logger {
  const logger = ctx.logger
  return {
    debug: (format, ...args) => (debugLogging ? logger.info(format, ...args) : logger.debug(format, ...args)),
    info: (format, ...args) => logger.info(format, ...args),
    warn: (format, ...args) => logger.warn(format, ...args),
  }
}
