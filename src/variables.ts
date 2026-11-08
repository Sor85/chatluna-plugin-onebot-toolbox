import type { Context } from 'cordis'
import type { Bot } from '@satorijs/core'
import type { PromptEnvironment, VariableDeclaration, VariableProvider } from '@chatluna/prompt'
import type { Config, GroupInfoItem, MemberInfoItem, OneBotProtocol } from './config'
import { DEFAULT_GROUP_INFO_ITEMS } from './config'
import type { Logger } from './logger'
import {
  asRecord,
  asMembers,
  callOneBot,
  formatDate,
  formatDateTime,
  normalizeTimestamp,
  oneBotOf,
  pickFirst,
  pickText,
  type MemberInfo,
} from './onebot'

const FALLBACK_MEMBER_ITEMS: MemberInfoItem[] = ['nickname', 'userId']

const SHUT_LIST_TIMEOUT_MS = 200
const SHUT_LIST_CACHE_TTL_MS = 15_000

function translateGender(value: unknown): string {
  if (value === 'male') return '男'
  if (value === 'female') return '女'
  return ''
}

function normalizeRole(value: string): string {
  if (value === 'owner') return '群主'
  if (value === 'admin') return '管理员'
  return !value || value === 'member' ? '群员' : value
}

/** 会话所在的 Satori 机器人，任意平台；预览等没有真实机器人的环境里为 undefined。 */
function botOf(ctx: Context, env: PromptEnvironment): Bot | undefined {
  return ctx.satori.bots.find((bot) => bot.platform === env.platform && bot.selfId === env.selfId)
}

/** 查询群成员信息；私聊、找不到机器人或查询失败时为 undefined，变量照常按已知信息渲染。 */
async function fetchMember(ctx: Context, env: PromptEnvironment, userId: string): Promise<MemberInfo | undefined> {
  const bot = botOf(ctx, env)
  if (!bot || !env.guildId) return undefined
  try {
    if (bot.platform === 'onebot') {
      return asRecord(await callOneBot(bot, 'get_group_member_info', {
        group_id: Number(env.guildId),
        user_id: Number(userId),
        no_cache: false,
      }))
    }
    const member = await bot.getGuildMember(env.guildId, userId)
    return {
      user_id: member.user?.id,
      card: pickText(member.nick, member.name),
      nickname: member.user?.name,
      role: member.roles?.[0]?.id,
      title: member.title,
      join_time: member.joinedAt,
    }
  } catch {
    return undefined
  }
}

/** 用户信息与机器人信息共用的渲染：按配置的信息项逐条输出，取不到的项省略。 */
function renderMember(member: MemberInfo | undefined, items: MemberInfoItem[], id: string, fallbackName: unknown): string[] {
  const values: string[] = []
  for (const item of items) {
    switch (item) {
      case 'nickname': {
        const name = pickText(member?.card, member?.nickname, fallbackName, id)
        if (name) values.push(`name:${name}`)
        break
      }
      case 'userId':
        if (id) values.push(`id:${id}`)
        break
      case 'role':
        values.push(`群内身份:${normalizeRole(pickText(member?.role))}`)
        break
      case 'level': {
        const level = pickFirst(member?.level)
        if (level !== undefined) values.push(`群等级:${level}`)
        break
      }
      case 'title': {
        const title = pickFirst(member?.title)
        if (title !== undefined) values.push(`头衔:${title}`)
        break
      }
      case 'gender': {
        const gender = translateGender(member?.sex)
        if (gender) values.push(`性别:${gender}`)
        break
      }
      case 'age': {
        const age = Number(member?.age)
        if (Number.isFinite(age) && age > 0) values.push(`年龄:${age}`)
        break
      }
      case 'area': {
        const area = pickFirst(member?.area)
        if (area !== undefined) values.push(`地区:${area}`)
        break
      }
      case 'joinTime': {
        const joinTime = formatDate(normalizeTimestamp(member?.join_time))
        if (joinTime) values.push(`入群:${joinTime}`)
        break
      }
      case 'lastSentTime': {
        const lastSentTime = formatDateTime(normalizeTimestamp(member?.last_sent_time))
        if (lastSentTime) values.push(`活跃:${lastSentTime}`)
        break
      }
    }
  }
  return values
}

const itemsOf = (items: MemberInfoItem[]) => items.length ? items : FALLBACK_MEMBER_ITEMS

export function userInfoProvider(ctx: Context, config: Config): VariableProvider {
  return async ({ env }) => {
    // 群聊里 userId 只来自本步最新的用户消息，工具调用后的后续步骤可能缺失，退回到消息发送者。
    const userId = (env.userId ?? env.message?.senderId)?.trim()
    if (!userId) return '未知用户'
    const member = await fetchMember(ctx, env, userId)
    const values = renderMember(member, itemsOf(config.userInfo.items), userId, env.userName ?? env.message?.senderName)
    return values.length ? values.join(', ') : `id:${userId}`
  }
}

export function botInfoProvider(ctx: Context, config: Config): VariableProvider {
  return async ({ env }) => {
    const botId = env.selfId?.trim()
    if (!botId) return '未知机器人'
    const member = await fetchMember(ctx, env, botId)
    const values = renderMember(member, itemsOf(config.botInfo.items), botId, undefined)
    return values.length ? values.join(', ') : botId
  }
}

interface GroupInfo {
  group_id?: unknown
  group_name?: unknown
  member_count?: unknown
  create_time?: unknown
  group_create_time?: unknown
}

async function fetchRoles(bot: Bot, guildId: string, log: Logger): Promise<{ owners: string[], admins: string[] } | undefined> {
  try {
    const members = asMembers(await callOneBot(bot, 'get_group_member_list', { group_id: Number(guildId) }))
    if (!members.length) return undefined
    const owners: string[] = []
    const admins: string[] = []
    for (const member of members) {
      const role = member.role
      const userId = pickText(member.user_id)
      const name = pickText(member.card, member.nickname, userId)
      const label = userId ? `${name}(${userId})` : name
      if (role === 'owner') owners.push(label)
      else if (role === 'admin') admins.push(label)
    }
    return { owners, admins }
  } catch (error) {
    log.debug('group roles lookup failed: %s', String(error))
    return undefined
  }
}

function renderGroupInfo(group: GroupInfo, items: GroupInfoItem[], roles: { owners: string[], admins: string[] } | undefined): string {
  const id = pickText(group.group_id)
  const name = pickText(group.group_name)
  const memberCount = group.member_count
  const createTime = formatDate(normalizeTimestamp(group.create_time ?? group.group_create_time))
  const values: string[] = []
  for (const item of items) {
    switch (item) {
      case 'groupName':
        if (name) values.push(`群名：${name}`)
        break
      case 'groupId':
        if (id) values.push(`群号：${id}`)
        break
      case 'memberCount':
        if (memberCount !== undefined && memberCount !== null) values.push(`成员数量：${String(memberCount)}`)
        break
      case 'createTime':
        if (createTime) values.push(`创建时间：${createTime}`)
        break
      case 'ownerList':
        if (roles) values.push(`群主：${roles.owners.length ? roles.owners.join('、') : '无'}`)
        break
      case 'adminList':
        if (roles) values.push(`管理员：${roles.admins.length ? roles.admins.join('、') : '无'}`)
        break
    }
  }
  return values.length ? values.join('\n') : id || name || '未能获取当前群信息。'
}

export function groupInfoProvider(ctx: Context, config: Config, log: Logger): VariableProvider {
  return async ({ env }) => {
    if (!env.guildId) return ''
    if (env.platform !== 'onebot') return '当前平台暂不支持查询群信息。'
    const bot = oneBotOf(ctx, env.platform, env.selfId)
    if (!bot) return '暂无群信息。'
    const items = config.groupInfo.items.length ? config.groupInfo.items : DEFAULT_GROUP_INFO_ITEMS
    const group = await callOneBot(bot, 'get_group_info', { group_id: Number(env.guildId), no_cache: false })
      .then(asRecord, () => undefined)
    if (!group) return '未能获取当前群信息。'
    const roles = items.includes('ownerList') || items.includes('adminList') ? await fetchRoles(bot, env.guildId, log) : undefined
    return renderGroupInfo(group, items, roles)
  }
}

class ShutListTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ShutListTimeout('group shut list request timed out')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function fetchShutList(bot: Bot, guildId: string, protocol: OneBotProtocol): Promise<unknown[]> {
  const groupId = protocol === 'llbot' ? guildId : Number(guildId)
  const data = await withTimeout(callOneBot(bot, 'get_group_shut_list', { group_id: groupId }), SHUT_LIST_TIMEOUT_MS)
  return Array.isArray(data) ? data : []
}

function renderShutItem(item: unknown): string | undefined {
  const record = asRecord(item)
  if (!record) return undefined
  const userId = pickText(record.uin, record.user_id)
  if (!userId) return undefined
  const name = pickText(record.cardName, record.remark, record.nick, record.nickname, userId)
  const until = formatDateTime(normalizeTimestamp(pickFirst(record.shutUpTime, record.shut_up_time))) || '未知'
  return `id：${userId}，name：${name}，禁言截至：${until}`
}

export function groupShutListProvider(ctx: Context, config: Config, log: Logger): VariableProvider {
  // 变量每一步都会重新渲染，同一个群的结果缓存 15 秒，避免每一步都请求一次。
  const cache = new Map<string, { value: string, expiresAt: number }>()
  return async ({ env }) => {
    if (!env.guildId) return ''
    if (env.platform !== 'onebot') return '当前平台暂不支持查询群禁言列表。'
    const bot = oneBotOf(ctx, env.platform, env.selfId)
    if (!bot) return '暂无群禁言列表。'
    const key = `${env.selfId}:${env.guildId}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    try {
      const lines = (await fetchShutList(bot, env.guildId, config.oneBotProtocol)).flatMap((item) => renderShutItem(item) ?? [])
      const value = lines.length ? lines.join('\n') : '当前群暂无禁言成员。'
      cache.set(key, { value, expiresAt: Date.now() + SHUT_LIST_CACHE_TTL_MS })
      return value
    } catch (error) {
      log.debug('group shut list failed: %s', String(error))
      // 部分实现在群里没有禁言成员时迟迟不响应，超时按空列表处理。
      return error instanceof ShutListTimeout ? '当前群暂无禁言成员。' : '获取群禁言列表失败。'
    }
  }
}

/** 按配置得到要注册的变量；变量名留空的不注册。 */
export function variableDefinitions(ctx: Context, config: Config, log: Logger): Array<[VariableDeclaration, VariableProvider]> {
  const entries: Array<[string, string, VariableProvider]> = [
    [config.userInfo.variableName, 'Current user info in this group', userInfoProvider(ctx, config)],
    [config.botInfo.variableName, 'Bot info in this group', botInfoProvider(ctx, config)],
    [config.groupInfo.variableName, 'Current group info', groupInfoProvider(ctx, config, log)],
    [config.groupShutList.variableName, 'Muted members of this group', groupShutListProvider(ctx, config, log)],
  ]
  // 都随群聊状态变化，属于可变变量，不能写进 system 区。
  return entries
    .filter(([name]) => name.trim())
    .map(([name, description, provider]) => [{ name: name.trim(), description, mutable: true }, provider])
}

export function registerVariables(ctx: Context, config: Config, log: Logger) {
  for (const [declaration, provider] of variableDefinitions(ctx, config, log)) {
    try {
      ctx.prompt.variable(declaration, provider)
    } catch (error) {
      // 同名变量已被其他插件注册时只跳过这一个，其余变量与工具照常可用。
      log.warn('variable %s not registered: %s', declaration.name, error instanceof Error ? error.message : String(error))
    }
  }
}
