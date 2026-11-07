import { describe, expect, it } from 'vitest'
import { fileRefTableOf, type ChatFileBlock, type ChatMessage } from '@chatluna/message'
import { createBot, createHost, failure, groupLocation } from './helpers/host'

async function call(ctx: Awaited<ReturnType<typeof createHost>>['ctx'], name: string, args: Record<string, unknown>, location: Record<string, unknown> = groupLocation) {
  return ctx.tools.execute({ name, args: JSON.parse(JSON.stringify(args)), location })
}

const textOf = (record: { ok: boolean, value?: unknown, error?: { message: string } }) =>
  record.ok ? record.value : record.error?.message

describe('原生工具注册', () => {
  it('全部工具按源插件的默认名称与描述注册，开关交给 v2 的工具管理', async () => {
    const { ctx } = await createHost()
    const tools = Object.fromEntries(ctx.tools.list().map((tool) => [tool.name, tool.description]))
    expect(Object.keys(tools)).toEqual([
      'set_self_profile', 'set_qq_avatar', 'set_group_card', 'search_group_member', 'set_group_leave',
      'handle_request', 'set_group_kick', 'set_group_special_title', 'delete_msg',
    ])
    expect(tools.set_group_kick).toBe('将指定成员踢出群聊。')
  })

  it('戳一戳、消息表情与禁言不再提供，交给 v2 自带的 OneBot 动作', async () => {
    const { ctx } = await createHost()
    const names = ctx.tools.list().map((tool) => tool.name)
    expect(names).toHaveLength(9)
    for (const name of ['poke_user', 'set_msg_emoji', 'set_group_ban']) expect(names).not.toContain(name)
  })

  it('不在 OneBot 会话里时报错，不调用任何机器人', async () => {
    const { ctx, bot } = await createHost()
    const record = await call(ctx, 'set_group_kick', { userId: '1' }, { platform: 'discord', selfId: '10000', guild: '1' })
    expect(record.ok).toBe(false)
    expect(textOf(record)).toContain('only supports OneBot')
    expect(bot.requests).toEqual([])
  })
})

describe('原生工具调用', () => {
  it('修改资料：LLBot 不发送性别', async () => {
    const napcat = await createHost()
    expect(textOf(await call(napcat.ctx, 'set_self_profile', { nickname: 'Luna', signature: 'hi', gender: 'female' }))).toBe('机器人资料已更新。')
    expect(napcat.bot.requests).toEqual([['set_qq_profile', { nickname: 'Luna', personal_note: 'hi', sex: '2' }]])
    const llbot = await createHost({ oneBotProtocol: 'llbot' })
    await call(llbot.ctx, 'set_self_profile', { nickname: 'Luna', gender: 'male' })
    expect(llbot.bot.requests).toEqual([['set_qq_profile', { nickname: 'Luna' }]])
  })

  it('修改头像：本地路径原样提交，HTTP 图片转成 base64', async () => {
    const { ctx, bot } = await createHost()
    await call(ctx, 'set_qq_avatar', { imageUrl: '/tmp/a.png' })
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]))
    try {
      expect(textOf(await call(ctx, 'set_qq_avatar', { imageUrl: 'https://example.com/a.png' }))).toBe('QQ 头像已更新。')
    } finally {
      globalThis.fetch = original
    }
    expect(bot.requests).toEqual([
      ['set_qq_avatar', { file: '/tmp/a.png' }],
      ['set_qq_avatar', { file: 'base64://AQID' }],
    ])
  })

  it('修改头像：会话图片按 ref 在 agent 的会话日志里解析，存储里的原图读成 base64', async () => {
    const { ctx, bot } = await createHost()
    ctx.provide('chatluna_storage')
    ctx.set('chatluna_storage', {
      getTempFile: async (id: string) => (id === 'stored' ? { data: Promise.resolve(Buffer.from([1, 2, 3])) } : null),
    } as never)
    const stored: ChatFileBlock = { type: 'file', mediaType: 'image/png', data: { type: 'reference', reference: 'storage://stored' }, preview: { type: 'data', data: 'cHJldmlldw==' } }
    const expired: ChatFileBlock = { type: 'file', mediaType: 'image/png', data: { type: 'reference', reference: 'storage://gone' } }
    const inline: ChatFileBlock = { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: 'data:image/jpeg;base64,BAUG' } }
    const audio: ChatFileBlock = { type: 'file', mediaType: 'audio/ogg', data: { type: 'data', data: 'AAAA' } }
    const messages = [{ id: 'm1', role: 'user', content: [stored, expired, { type: 'envelope', kind: 'message', id: 'e1', content: [inline, audio] }] }] as unknown as ChatMessage[]
    const refs = fileRefTableOf(messages)
    const agent = { options: {}, session: { messages: () => messages } }
    const avatar = (imageUrl: string, withAgent = true) =>
      ctx.tools.execute({ name: 'set_qq_avatar', args: { imageUrl }, location: groupLocation, ...(withAgent ? { agent } : {}) })

    expect(textOf(await avatar(refs.refOf(stored)))).toBe('QQ 头像已更新。')
    expect(textOf(await avatar(refs.refOf(inline)))).toBe('QQ 头像已更新。')
    expect(textOf(await avatar('storage://stored'))).toBe('QQ 头像已更新。')
    expect(textOf(await avatar(refs.refOf(expired)))).toContain('storage://gone is not in storage')
    expect(textOf(await avatar(refs.refOf(audio)))).toContain('not an image')
    expect(textOf(await avatar('iffffff0'))).toContain('is not in this conversation')
    expect(textOf(await avatar(refs.refOf(stored), false))).toContain('can only be resolved inside a conversation')
    // 用原图，不用写入时压缩的 preview。
    expect(bot.requests).toEqual([
      ['set_qq_avatar', { file: 'base64://AQID' }],
      ['set_qq_avatar', { file: 'base64://BAUG' }],
      ['set_qq_avatar', { file: 'base64://AQID' }],
    ])
  })

  it('群名片、头衔、踢人、退群默认作用于当前群，也可以指定群号', async () => {
    const { ctx, bot } = await createHost()
    expect(textOf(await call(ctx, 'set_group_card', { userId: '1', card: ' 小明 ' }))).toBe('群昵称已更新：1 -> 小明')
    expect(textOf(await call(ctx, 'set_group_special_title', { userId: '1', title: '' }))).toBe('群专属头衔已清除：1')
    expect(textOf(await call(ctx, 'set_group_special_title', { groupId: '3', userId: '1', title: '头衔' }))).toBe('群专属头衔已更新：1 -> 头衔')
    expect(textOf(await call(ctx, 'set_group_kick', { userId: '1' }))).toBe('已将用户 1 移出群 20000。')
    expect(textOf(await call(ctx, 'set_group_leave', {}))).toBe('已退出群 20000。')
    expect(bot.requests).toEqual([
      ['set_group_card', { group_id: '20000', user_id: '1', card: '小明' }],
      ['set_group_special_title', { group_id: '20000', user_id: '1', special_title: '' }],
      ['set_group_special_title', { group_id: '3', user_id: '1', special_title: '头衔' }],
      ['set_group_kick', { group_id: '20000', user_id: '1' }],
      ['set_group_leave', { group_id: '20000' }],
    ])
  })

  it('私聊里没给群号时报缺少 groupId', async () => {
    const { ctx, bot } = await createHost()
    const record = await call(ctx, 'set_group_kick', { userId: '1' }, { platform: 'onebot', selfId: '10000', isDirect: true, channel: 'private:1' })
    expect(textOf(record)).toContain('Missing groupId')
    expect(bot.requests).toEqual([])
  })

  it('搜索群成员：数字按 qqid 精确匹配，其余按群昵称与 QQ 昵称模糊匹配，最多列出 10 条', async () => {
    const members = [
      { user_id: 1, card: '小明', nickname: 'Ming' },
      { user_id: 2, card: '', nickname: '小红' },
      ...Array.from({ length: 12 }, (_, index) => ({ user_id: 100 + index, card: `路人${index}`, nickname: 'x' })),
    ]
    const bot = createBot('10000', { get_group_member_list: () => members })
    const { ctx } = await createHost({}, [bot])
    expect(textOf(await call(ctx, 'search_group_member', { query: '2' }))).toBe('找到 1 个匹配成员：\n1. qqid：2，群昵称：无，QQ昵称：小红')
    expect(textOf(await call(ctx, 'search_group_member', { query: 'ming' }))).toBe('找到 1 个匹配成员：\n1. qqid：1，群昵称：小明，QQ昵称：Ming')
    const many = String(textOf(await call(ctx, 'search_group_member', { query: '路人' })))
    expect(many.split('\n')[0]).toBe('仅显示前 10 条，共 12 条匹配：')
    expect(many.split('\n')).toHaveLength(11)
    expect(textOf(await call(ctx, 'search_group_member', { query: '小明', mode: 'byQQ' }))).toBe('未找到匹配的群成员。')
    expect(bot.requests[0]).toEqual(['get_group_member_list', { group_id: 20000 }])
  })

  it('处理申请：好友申请带备注，群申请必须给出 subType', async () => {
    const { ctx, bot } = await createHost()
    expect(textOf(await call(ctx, 'handle_request', { requestType: 'friend', flag: 'f1', approve: true, remark: '朋友' }))).toBe('已同意好友申请 f1。')
    expect(textOf(await call(ctx, 'handle_request', { requestType: 'group', flag: 'g1', approve: false }))).toContain('subType is required')
    expect(textOf(await call(ctx, 'handle_request', { requestType: 'group', flag: 'g1', approve: false, subType: 'invite', reason: '不认识' }))).toBe('已拒绝群邀请 g1。')
    expect(bot.requests).toEqual([
      ['set_friend_add_request', { flag: 'f1', approve: true, remark: '朋友' }],
      ['set_group_add_request', { flag: 'g1', sub_type: 'invite', approve: false, reason: '不认识' }],
    ])
  })

  it('撤回消息：纯数字的消息 ID 以数字提交', async () => {
    const { ctx, bot } = await createHost()
    expect(textOf(await call(ctx, 'delete_msg', { message_id: '123' }))).toBe('Message deleted by ID 123.')
    await call(ctx, 'delete_msg', { message_id: 'abc' })
    expect(bot.requests).toEqual([['delete_msg', { message_id: 123 }], ['delete_msg', { message_id: 'abc' }]])
  })

  it('SnowLuma：同意好友申请后另用 set_friend_remark 设置备注，负数消息 ID 以数字提交', async () => {
    const { ctx, bot } = await createHost({ oneBotProtocol: 'snowluma' })
    expect(textOf(await call(ctx, 'handle_request', { requestType: 'friend', flag: 'u_abc', approve: true, remark: '朋友', userId: '1' })))
      .toBe('已同意好友申请 u_abc。备注已设置为 朋友。')
    expect(textOf(await call(ctx, 'handle_request', { requestType: 'friend', flag: 'u_def', approve: true, remark: '朋友' })))
      .toBe('已同意好友申请 u_def。未提供申请人 userId，备注未设置。')
    await call(ctx, 'handle_request', { requestType: 'friend', flag: 'u_ghi', approve: false, remark: '朋友', userId: '2' })
    await call(ctx, 'delete_msg', { message_id: '-123456' })
    expect(bot.requests).toEqual([
      ['set_friend_add_request', { flag: 'u_abc', approve: true, remark: '朋友' }],
      ['set_friend_remark', { user_id: 1, remark: '朋友' }],
      ['set_friend_add_request', { flag: 'u_def', approve: true, remark: '朋友' }],
      ['set_friend_add_request', { flag: 'u_ghi', approve: false, remark: '朋友' }],
      ['delete_msg', { message_id: -123456 }],
    ])
  })

  it('OneBot 以正常响应包返回的业务失败报给模型', async () => {
    const bot = createBot('10000', { set_group_kick: () => failure('权限不足') })
    const { ctx } = await createHost({}, [bot])
    const record = await call(ctx, 'set_group_kick', { userId: '1' })
    expect(record.ok).toBe(false)
    expect(textOf(record)).toBe('set_group_kick failed: 权限不足 (retcode: 100)')
  })

  it('参数不合法时不调用机器人', async () => {
    const { ctx, bot } = await createHost()
    const record = await call(ctx, 'set_group_card', { userId: '1' })
    expect(record.ok).toBe(false)
    expect(bot.requests).toEqual([])
  })
})

describe('原生工具只在 OneBot 会话中可见', () => {
  it('非 OneBot 的 agent 看不到工具，OneBot 的 agent 看得到', async () => {
    const { ctx } = await createHost()
    const agents: Array<{ options: { location?: { platform?: string } } }> = []
    // 只需要 `list` 与 `chatluna/agent-open` 两个面，装一个最小的 agents 服务。
    ctx.provide('agents')
    ctx.set('agents', { list: () => agents })
    const web = { options: { location: { platform: 'web' } } }
    const onebot = { options: { location: { platform: 'onebot' } } }
    agents.push(web)
    await new Promise((resolve) => setTimeout(resolve, 0))
    ctx.emit('chatluna/agent-open', { agent: onebot, kind: 'create' } as never)
    expect(ctx.tools.list(web)).toEqual([])
    expect(ctx.tools.list(onebot).map((tool) => tool.name)).toHaveLength(9)
  })
})
