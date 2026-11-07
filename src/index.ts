import type { Context } from 'cordis'
import type { Config } from './config'
import { createLogger } from './logger'
import { registerRequestNotices } from './requests'
import { registerNativeTools } from './tools'
import { registerVariables } from './variables'

export * from './config'
export * from './onebot'
export * from './requests'
export * from './tools'
export * from './variables'

export const name = 'chatluna-onebot-toolbox'

/** 过滤工具用的 agents 与唤醒用的 chat 是可选服务。 */
export const inject = ['satori', 'tools', 'prompt']

export function apply(ctx: Context, config: Config) {
  const log = createLogger(ctx, config.debugLogging)
  registerVariables(ctx, config, log)
  registerNativeTools(ctx, config, log)
  registerRequestNotices(ctx, config, log)
}
