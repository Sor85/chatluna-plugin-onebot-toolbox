import { describe, expect, it } from 'vitest'
import { createBot, createHost, failure, groupEnv } from './helpers/host'

const member = {
  user_id: 30000,
  card: '小明',
  nickname: 'Ming',
  role: 'admin',
  level: '42',
  title: '大佬',
  sex: 'male',
  age: 20,
  area: '上海',
  join_time: 1700000000,
  last_sent_time: 1750000000,
}

async function render(ctx: Awaited<ReturnType<typeof createHost>>['ctx'], source: string, env = groupEnv(), zone: 'context' | 'system' | 'input' = 'context') {
  return (await ctx.prompt.render(source, { zone, env })).text
}

describe('变量注册', () => {
  it('四个变量都注册为可变变量，随机数交给 v2 自带的 random', async () => {
    const { ctx } = await createHost()
    const names = ctx.prompt.catalog().map((entry) => entry.declaration?.name ?? entry)
    for (const name of ['userInfo', 'botInfo', 'groupInfo', 'groupShutList']) expect(JSON.stringify(names)).toContain(name)
    await expect(render(ctx, '{userInfo}', groupEnv(), 'system')).rejects.toThrow()
  })

  it('变量名可以改，留空时不注册', async () => {
    const { ctx } = await createHost({ userInfo: { variableName: 'who', items: ['userId'] }, botInfo: { variableName: '', items: [] } })
    expect(await render(ctx, '{who}|{botInfo}')).toBe('id:30000|')
  })
})

describe('用户与机器人信息', () => {
  it('按配置的信息项渲染群成员信息', async () => {
    const bot = createBot('10000', { get_group_member_info: ({ user_id }) => ({ ...member, user_id }) })
    const { ctx } = await createHost({}, [bot])
    const text = await render(ctx, '{userInfo}')
    expect(text).toMatch(/^name:小明, id:30000, 群内身份:管理员, 群等级:42, 头衔:大佬, 性别:男, 年龄:20, 地区:上海, 入群:2023-11-1\d, 活跃:2025-06-1\d \d\d:\d\d$/)
    expect(bot.requests[0]).toEqual(['get_group_member_info', { group_id: 20000, user_id: 30000, no_cache: false }])
    expect(await render(ctx, '{botInfo}')).toMatch(/^name:小明, id:10000, 群内身份:管理员/)
    expect(bot.requests[1]?.[1]).toMatchObject({ user_id: 10000 })
  })

  it('群聊里本步没有 userId 时退回消息发送者，信息项留空时只输出昵称与 ID', async () => {
    const bot = createBot('10000', { get_group_member_info: () => member })
    const { ctx } = await createHost({ userInfo: { variableName: 'userInfo', items: [] } }, [bot])
    expect(await render(ctx, '{userInfo}', groupEnv({ userId: undefined, message: { senderId: '30001' } }))).toBe('name:小明, id:30001')
  })

  it('私聊与查询失败时按已知信息渲染', async () => {
    const bot = createBot('10000', { get_group_member_info: () => failure('not found') })
    const { ctx } = await createHost({ userInfo: { variableName: 'userInfo', items: ['nickname', 'userId', 'role'] } }, [bot])
    expect(await render(ctx, '{userInfo}', groupEnv({ isDirect: true, guildId: undefined, userName: 'Ann' }))).toBe('name:Ann, id:30000, 群内身份:群员')
    expect(await render(ctx, '{userInfo}')).toBe('name:30000, id:30000, 群内身份:群员')
    expect(await render(ctx, '{userInfo}', groupEnv({ userId: undefined }))).toBe('未知用户')
  })
})

describe('群信息', () => {
  const members = [
    { user_id: 1, card: '', nickname: '群主', role: 'owner' },
    { user_id: 2, card: '管一', nickname: 'a', role: 'admin' },
    { user_id: 3, card: '管二', nickname: 'b', role: 'admin' },
    { user_id: 4, card: '群员', nickname: 'c', role: 'member' },
  ]

  it('输出群名、群号、人数与管理名单', async () => {
    const bot = createBot('10000', {
      get_group_info: () => ({ group_id: 20000, group_name: '测试群', member_count: 4, create_time: 0 }),
      get_group_member_list: () => members,
    })
    const { ctx } = await createHost({ groupInfo: { variableName: 'groupInfo', items: ['groupName', 'groupId', 'memberCount', 'createTime', 'ownerList', 'adminList'] } }, [bot])
    expect(await render(ctx, '{groupInfo}')).toBe('群名：测试群\n群号：20000\n成员数量：4\n群主：群主(1)\n管理员：管一(2)、管二(3)')
  })

  it('SnowLuma 的创建时间字段是 group_create_time，禁言列表用数字群号且字段为 user_id/nickname/shut_up_time', async () => {
    const bot = createBot('10000', {
      get_group_info: () => ({ group_id: 20000, group_name: '测试群', member_count: 4, group_create_time: 1700000000 }),
      get_group_shut_list: () => [{ user_id: 5, nickname: '小黑', shut_up_time: 1750000000 }],
    })
    const { ctx } = await createHost({ oneBotProtocol: 'snowluma', groupInfo: { variableName: 'groupInfo', items: ['groupName', 'createTime'] } }, [bot])
    expect(await render(ctx, '{groupInfo}')).toMatch(/^群名：测试群\n创建时间：2023-11-1\d$/)
    expect(await render(ctx, '{groupShutList}')).toMatch(/^id：5，name：小黑，禁言截至：2025-06-1\d \d\d:\d\d$/)
    expect(bot.requests.at(-1)).toEqual(['get_group_shut_list', { group_id: 20000 }])
  })

  it('私聊为空，非 OneBot 平台给出说明，查询失败给出提示', async () => {
    const bot = createBot('10000', { get_group_info: () => failure('boom') })
    const { ctx } = await createHost({}, [bot])
    expect(await render(ctx, '{groupInfo}', groupEnv({ guildId: undefined, isDirect: true }))).toBe('')
    expect(await render(ctx, '{groupInfo}', groupEnv({ platform: 'discord' }))).toBe('当前平台暂不支持查询群信息。')
    expect(await render(ctx, '{groupInfo}')).toBe('未能获取当前群信息。')
  })
})

describe('群禁言列表', () => {
  it('兼容 NapCat 与 LLBot 两种字段，结果缓存 15 秒', async () => {
    const bot = createBot('10000', {
      get_group_shut_list: () => [
        { uin: 1, cardName: '小明', shutUpTime: 1750000000 },
        { user_id: 2, nickname: '小红', shut_up_time: 0 },
      ],
    })
    const { ctx } = await createHost({}, [bot])
    const text = await render(ctx, '{groupShutList}')
    expect(text).toMatch(/^id：1，name：小明，禁言截至：2025-06-1\d \d\d:\d\d\nid：2，name：小红，禁言截至：未知$/)
    expect(await render(ctx, '{groupShutList}')).toBe(text)
    expect(bot.requests).toEqual([['get_group_shut_list', { group_id: 20000 }]])
  })

  it('LLBot 先用字符串群号，类型不被接受时换成数字再试', async () => {
    const bot = createBot('10000', {
      get_group_shut_list: ({ group_id }) => typeof group_id === 'string' ? failure('group_id number required') : [],
    })
    const { ctx } = await createHost({ oneBotProtocol: 'llbot' }, [bot])
    expect(await render(ctx, '{groupShutList}')).toBe('当前群暂无禁言成员。')
    expect(bot.requests).toEqual([['get_group_shut_list', { group_id: '20000' }], ['get_group_shut_list', { group_id: 20000 }]])
  })

  it('请求超时按空列表处理，其余失败给出提示', async () => {
    const slow = createBot('10000', { get_group_shut_list: () => new Promise((resolve) => setTimeout(() => resolve([]), 500)) })
    const { ctx } = await createHost({}, [slow])
    expect(await render(ctx, '{groupShutList}')).toBe('当前群暂无禁言成员。')
    const broken = createBot('10000', { get_group_shut_list: () => failure('boom') })
    const other = await createHost({}, [broken])
    expect(await render(other.ctx, '{groupShutList}')).toBe('获取群禁言列表失败。')
  })
})
