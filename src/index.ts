import type { Context } from 'cordis'
import type { Config } from './config'
import { createLogger } from './logger'
import { registerRequestNotices } from './requests'
import { registerNativeTools } from './tools'
import { registerVariables } from './variables'

export * from './config'

export const name = 'chatluna-onebot-toolbox'

/** 过滤工具用的 agents、唤醒用的 chat 与读取会话图片用的 chatluna_storage 是可选服务。 */
export const inject = ['satori', 'tools', 'prompt']

export function apply(ctx: Context, config: Config) {
  const log = createLogger(ctx, config.debugLogging)
  registerVariables(ctx, config, log)
  registerNativeTools(ctx, config, log)
  registerRequestNotices(ctx, config, log)
}
