import { describe, expect, it } from 'vitest'
import { Session } from '@satorijs/core'
import type { Context } from 'cordis'
import { createHost } from './helpers/host'

function requestSession(ctx: Context, type: string, fields: { userId: string, guildId?: string, flag: string, comment?: string }) {
  const session = new Session({ ctx, platform: 'onebot', selfId: '10000' } as never, { type, selfId: '10000', platform: 'onebot' } as never)
  session.userId = fields.userId
  if (fields.guildId) session.guildId = session.channelId = fields.guildId
  session.messageId = fields.flag
  session.content = fields.comment ?? ''
  return session
}

async function hostWithChat(config: Parameters<typeof createHost>[0]) {
  const { ctx } = await createHost(config)
  const wakes: Array<[unknown, { reason: string, by: string }]> = []
  ctx.provide('chat')
  ctx.set('chat', { wake: async (target: unknown, options: { reason: string, by: string }) => void wakes.push([target, options]) })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ctx, wakes }
}

describe('申请通知', () => {
  it('好友申请唤醒与申请人的私聊，带上 flag 与附言', async () => {
    const { ctx, wakes } = await hostWithChat({})
    ctx.emit('friend-request', requestSession(ctx, 'friend-request', { userId: '1', flag: 'f-1', comment: '我是小明' }))
    expect(wakes).toHaveLength(1)
    const [target, options] = wakes[0]!
    expect(target).toEqual({ platform: 'onebot', selfId: '10000', isDirect: true, channelId: 'private:1', userId: '1' })
    expect(options.reason).toBe('user 1 sent you a friend request (flag: "f-1", message: "我是小明"). Call handle_request with requestType "friend" and userId "1" to approve or reject it')
  })

  it('加群申请唤醒所申请的群，群邀请唤醒邀请人的私聊', async () => {
    const { ctx, wakes } = await hostWithChat({})
    ctx.emit('guild-member-request', requestSession(ctx, 'guild-member-request', { userId: '2', guildId: '20000', flag: 'g-1' }))
    ctx.emit('guild-request', requestSession(ctx, 'guild-request', { userId: '3', guildId: '30000', flag: 'g-2' }))
    expect(wakes.map(([target]) => target)).toEqual([
      { platform: 'onebot', selfId: '10000', isDirect: false, guildId: '20000', channelId: '20000', userId: '2' },
      { platform: 'onebot', selfId: '10000', isDirect: true, channelId: 'private:3', userId: '3' },
    ])
    expect(wakes[0]![1].reason).toContain('subType "add"')
    expect(wakes[1]![1].reason).toBe('user 3 invited you to join group 30000 (flag: "g-2"). Call handle_request with requestType "group" and subType "invite" to approve or reject it')
  })

  it('事件没有 flag 时不唤醒', async () => {
    const { ctx, wakes } = await hostWithChat({})
    ctx.emit('friend-request', requestSession(ctx, 'friend-request', { userId: '1', flag: '' }))
    expect(wakes).toEqual([])
  })

  it('处理申请工具在 v2 工具管理里被禁用时不唤醒，重新启用后恢复', async () => {
    const { ctx, wakes } = await hostWithChat({})
    // 工具管理页的禁用由 @chatluna/tool-policy 落成一层全局 exclude 过滤。
    const enable = ctx.tools.filter({ exclude: ['handle_request'] })
    ctx.emit('friend-request', requestSession(ctx, 'friend-request', { userId: '1', flag: 'f-1' }))
    expect(wakes).toEqual([])
    enable()
    ctx.emit('friend-request', requestSession(ctx, 'friend-request', { userId: '1', flag: 'f-2' }))
    expect(wakes).toHaveLength(1)
  })

  it('关闭申请通知时不唤醒', async () => {
    const { ctx, wakes } = await hostWithChat({ requestNotice: false })
    ctx.emit('friend-request', requestSession(ctx, 'friend-request', { userId: '1', flag: 'f-1' }))
    expect(wakes).toEqual([])
  })
})
