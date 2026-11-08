import { Context } from 'cordis'
import { Satori } from '@satorijs/core'
import type { PromptEnvironment } from '@chatluna/prompt'
import * as toolbox from '../../src'

type Responder = (params: Record<string, unknown>) => unknown

/** 假的 OneBot 机器人：记录每个 action 的参数，按 action 返回预设的 OneBot 响应包。 */
export function createBot(selfId = '10000', responders: Record<string, Responder> = {}) {
  const requests: Array<[string, Record<string, unknown>]> = []
  const bot = {
    platform: 'onebot',
    selfId,
    requests,
    internal: {
      async _request(action: string, params: Record<string, unknown>) {
        requests.push([action, params])
        const responder = responders[action]
        const data = responder ? await responder(params) : null
        return data instanceof Envelope ? data.value : { status: 'ok', retcode: 0, data }
      },
    },
  }
  return bot
}

type FakeBot = ReturnType<typeof createBot>

/** responder 返回它时，原样作为整个响应包返回，用来模拟 OneBot 的业务失败。 */
class Envelope {
  constructor(readonly value: unknown) {}
}

export const failure = (wording: string, retcode = 100) => new Envelope({ status: 'failed', retcode, wording, data: null })

/** 装上真实的 Satori、工具与提示词服务，再加载工具箱插件。 */
export async function createHost(config: Partial<toolbox.Config> = {}, bots: FakeBot[] = [createBot()]) {
  const ctx = new Context()
  await ctx.plugin(Satori)
  await ctx.plugin((await import('@chatluna/tool')).default, {})
  await ctx.plugin((await import('@chatluna/prompt')).default, { immutableWindow: 30 })
  for (const bot of bots) ctx.satori.bots.push(bot as never)
  await ctx.plugin(toolbox, toolbox.Config(config))
  return { ctx, bot: bots[0]! }
}

export const groupLocation = { platform: 'onebot', selfId: '10000', isDirect: false, guild: '20000', channel: '20000' }

export function groupEnv(extra: Partial<PromptEnvironment> = {}): PromptEnvironment {
  return { now: Date.now(), platform: 'onebot', selfId: '10000', isDirect: false, guildId: '20000', channelId: '20000', userId: '30000', ...extra }
}
