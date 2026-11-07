import type { Context } from 'cordis'
import type { Session } from '@satorijs/core'
import type { RouteIdentity } from '@chatluna/satori'
import type {} from '@chatluna/chat'
import type { Config } from './config'
import { NATIVE_TOOLS } from './config'
import type { Logger } from './logger'

type RequestKind = 'friend' | 'add' | 'invite'

/**
 * 申请发往的会话：好友申请与群邀请发往申请人的私聊，加群申请发往所申请的群。
 * 用路由身份而不是事件 Session 唤醒：申请事件不是消息，申请人与机器人之间往往还没有会话，
 * `chat.wake` 会按身份新开一个。
 */
export function requestTarget(session: Session, kind: RequestKind): RouteIdentity | undefined {
  if (!session.userId) return undefined
  if (kind === 'add') {
    if (!session.guildId) return undefined
    return { platform: session.platform, selfId: session.selfId, isDirect: false, guildId: session.guildId, channelId: session.guildId, userId: session.userId }
  }
  return { platform: session.platform, selfId: session.selfId, isDirect: true, channelId: `private:${session.userId}`, userId: session.userId }
}

/** 唤醒原因即模型看到的通知，写明 flag 与调用方式，模型据此调用处理申请工具。 */
export function requestReason(session: Session, kind: RequestKind, toolName: string): string {
  const comment = session.content?.trim() ? `, message: ${JSON.stringify(session.content.trim())}` : ''
  const flag = `flag: ${JSON.stringify(session.messageId ?? '')}`
  if (kind === 'friend') {
    return `user ${session.userId} sent you a friend request (${flag}${comment}). Call ${toolName} with requestType "friend" and userId "${session.userId}" to approve or reject it`
  }
  if (kind === 'add') {
    return `user ${session.userId} requested to join group ${session.guildId} (${flag}${comment}). Call ${toolName} with requestType "group" and subType "add" to approve or reject it`
  }
  return `user ${session.userId} invited you to join group ${session.guildId} (${flag}${comment}). Call ${toolName} with requestType "group" and subType "invite" to approve or reject it`
}

/**
 * v2 不把 OneBot 的申请事件交给模型，`handle_request` 拿不到 flag 就无从调用，
 * 所以把申请转成一次唤醒；工具在 v2 工具管理里被禁用时跟着不唤醒。会话所在路由关闭或没选模型时 `wake` 会报错，只记调试日志。
 */
export function registerRequestNotices(ctx: Context, config: Config, log: Logger) {
  if (!config.requestNotice) return
  const toolName = NATIVE_TOOLS.handleRequest.toolName
  ctx.inject(['chat'], (inner) => {
    const notify = (session: Session, kind: RequestKind) => {
      if (session.platform !== 'onebot') return
      // 没有 flag 时模型无从处理申请，唤醒只会让它拿空值反复试错。
      if (!session.messageId) return log.debug('%s request without flag ignored', kind)
      // 工具在 v2 工具管理里被禁用时（全局过滤排除了它）不唤醒：模型调用不到，唤醒只会让它白跑一轮。
      if (!inner.tools.list().some((tool) => tool.name === toolName)) return log.debug('%s request ignored: %s is disabled', kind, toolName)
      const target = requestTarget(session, kind)
      if (!target) return
      inner.chat.wake(target, { reason: requestReason(session, kind, toolName), by: 'onebot-toolbox' })
        .then(() => log.debug('%s request %s delivered', kind, session.messageId))
        .catch((error: unknown) => log.debug('%s request %s not delivered: %s', kind, session.messageId, String(error)))
    }
    inner.on('friend-request', (session) => notify(session, 'friend'))
    inner.on('guild-member-request', (session) => notify(session, 'add'))
    inner.on('guild-request', (session) => notify(session, 'invite'))
  })
}
