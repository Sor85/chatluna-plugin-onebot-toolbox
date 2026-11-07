import type { Context } from 'cordis'
import type { Bot } from '@satorijs/core'
import { Schema } from '@chatluna/schema'
import type { ToolCallContext, ToolDefinition } from '@chatluna/tool'
import type { Agent } from '@chatluna/agent'
import type {} from '@chatluna/tool'
import type { Config, NativeToolKey, OneBotProtocol } from './config'
import { NATIVE_TOOL_KEYS, NATIVE_TOOLS } from './config'
import type { Logger } from './logger'
import {
  asMembers,
  callOneBot,
  memberCard,
  memberNickname,
  memberUserId,
  numericId,
  oneBotOf,
  type MemberInfo,
} from './onebot'

/** 工具执行时的上下文：会话所在的机器人与群。 */
export interface ToolScope {
  bot: Bot
  /** 会话所在群；私聊为 undefined。 */
  guildId?: string
  protocol: OneBotProtocol
}

interface NativeTool<A> {
  args: Schema<any, A>
  effect: 'read' | 'write'
  run(scope: ToolScope, args: A): Promise<string>
}

const MISSING_GROUP = 'Missing groupId. Provide groupId explicitly or run inside a group session.'
const MAX_MEMBER_RESULTS = 10

const groupIdArg = () => Schema.string().required(false).description('Target group ID. Defaults to current session group.')

function groupOf(scope: ToolScope, groupId: string | undefined): string {
  const resolved = groupId?.trim() || scope.guildId?.trim()
  if (!resolved) throw new Error(MISSING_GROUP)
  return resolved
}

function required(value: string, name: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${name} is required.`)
  return trimmed
}

const GENDERS = { unknown: '0', male: '1', female: '2' }

/** HTTP/HTTPS 图片先读成 base64：OneBot 端常访问不到临时 URL，或 URL 在提交前就已过期。 */
async function avatarFile(imageUrl: string): Promise<string> {
  if (!/^https?:\/\//i.test(imageUrl)) return imageUrl
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return `base64://${Buffer.from(await response.arrayBuffer()).toString('base64')}`
  } catch (error) {
    throw new Error(`无法读取头像图片：${error instanceof Error ? error.message : String(error)}`)
  }
}

function formatMember(index: number, member: MemberInfo): string {
  return `${index}. qqid：${memberUserId(member) || '未知'}，群昵称：${memberCard(member) || '无'}，QQ昵称：${memberNickname(member) || '无'}`
}

export const NATIVE_TOOL_IMPLEMENTATIONS: { [K in NativeToolKey]: NativeTool<any> } = {
  setSelfProfile: {
    args: Schema.args({
      nickname: Schema.string().min(1).description('The new nickname for the bot.'),
      signature: Schema.string().required(false).description('Optional: the new personal signature.'),
      gender: Schema.union(['unknown', 'male', 'female']).required(false).description('Optional: the new gender.'),
    }),
    effect: 'write',
    async run(scope, args: { nickname: string, signature?: string, gender?: keyof typeof GENDERS }) {
      await callOneBot(scope.bot, 'set_qq_profile', {
        nickname: args.nickname,
        ...(args.signature ? { personal_note: args.signature } : {}),
        // LLBot 的 set_qq_profile 不接受 sex。
        ...(args.gender && scope.protocol !== 'llbot' ? { sex: GENDERS[args.gender] } : {}),
      })
      return '机器人资料已更新。'
    },
  },
  setQQAvatar: {
    args: Schema.args({
      imageUrl: Schema.string().min(1).description('Image URL or local file path readable by the OneBot side.'),
    }),
    effect: 'write',
    async run(scope, args: { imageUrl: string }) {
      const file = await avatarFile(required(args.imageUrl, 'imageUrl'))
      await callOneBot(scope.bot, 'set_qq_avatar', { file })
      return 'QQ 头像已更新。'
    },
  },
  setGroupCard: {
    args: Schema.args({
      groupId: groupIdArg(),
      userId: Schema.string().min(1).description('Target member user ID.'),
      card: Schema.string().min(1).description('New group card for the member.'),
    }),
    effect: 'write',
    async run(scope, args: { groupId?: string, userId: string, card: string }) {
      const groupId = groupOf(scope, args.groupId)
      const userId = required(args.userId, 'userId')
      const card = required(args.card, 'card')
      await callOneBot(scope.bot, 'set_group_card', { group_id: groupId, user_id: userId, card })
      return `群昵称已更新：${userId} -> ${card}`
    },
  },
  searchGroupMember: {
    args: Schema.args({
      groupId: groupIdArg(),
      query: Schema.string().min(1).description('qqid, group card, or QQ nickname to search.'),
      mode: Schema.union(['auto', 'byName', 'byQQ']).required(false).description('Search mode. Defaults to auto.'),
    }),
    effect: 'read',
    async run(scope, args: { groupId?: string, query: string, mode?: 'auto' | 'byName' | 'byQQ' }) {
      const query = required(args.query, 'query')
      const mode = args.mode ?? 'auto'
      const groupId = groupOf(scope, args.groupId)
      const members = asMembers(await callOneBot(scope.bot, 'get_group_member_list', { group_id: numericId(groupId) }))
      const byQQ = mode === 'byQQ' || (mode === 'auto' && /^\d+$/.test(query))
      const keyword = query.toLowerCase()
      const matches = members.filter((member) => byQQ
        ? memberUserId(member) === query
        : [memberCard(member), memberNickname(member)].some((name) => name && name.toLowerCase().includes(keyword)))
      if (!matches.length) return '未找到匹配的群成员。'
      const header = matches.length > MAX_MEMBER_RESULTS
        ? `仅显示前 ${MAX_MEMBER_RESULTS} 条，共 ${matches.length} 条匹配：`
        : `找到 ${matches.length} 个匹配成员：`
      return [header, ...matches.slice(0, MAX_MEMBER_RESULTS).map((member, index) => formatMember(index + 1, member))].join('\n')
    },
  },
  leaveGroup: {
    args: Schema.args({ groupId: groupIdArg() }),
    effect: 'write',
    async run(scope, args: { groupId?: string }) {
      const groupId = groupOf(scope, args.groupId)
      await callOneBot(scope.bot, 'set_group_leave', { group_id: groupId })
      return `已退出群 ${groupId}。`
    },
  },
  handleRequest: {
    args: Schema.args({
      requestType: Schema.union(['friend', 'group']).description('Request type: friend or group.'),
      flag: Schema.string().min(1).description('OneBot request flag from the event.'),
      approve: Schema.boolean().description('true to approve the request, false to reject it.'),
      subType: Schema.union(['add', 'invite']).required(false).description('Required for group requests: add or invite.'),
      remark: Schema.string().required(false).description('Optional friend remark when approving a friend request.'),
      userId: Schema.string().required(false).description('Requester user ID of a friend request; needed to apply the remark on SnowLuma.'),
      reason: Schema.string().required(false).description('Optional rejection reason for a group request.'),
    }),
    effect: 'write',
    async run(scope, args: { requestType: 'friend' | 'group', flag: string, approve: boolean, subType?: 'add' | 'invite', remark?: string, userId?: string, reason?: string }) {
      const flag = required(args.flag, 'request flag')
      const verb = args.approve ? '同意' : '拒绝'
      if (args.requestType === 'friend') {
        const remark = args.remark?.trim() ?? ''
        await callOneBot(scope.bot, 'set_friend_add_request', { flag, approve: args.approve, remark })
        const message = `已${verb}好友申请 ${flag}。`
        // SnowLuma 的 set_friend_add_request 不读 remark，同意后另用 set_friend_remark 设置。
        if (scope.protocol !== 'snowluma' || !args.approve || !remark) return message
        const userId = args.userId?.trim()
        if (!userId) return `${message}未提供申请人 userId，备注未设置。`
        await callOneBot(scope.bot, 'set_friend_remark', { user_id: numericId(userId), remark })
        return `${message}备注已设置为 ${remark}。`
      }
      if (!args.subType) throw new Error('subType is required for group requests; use add or invite.')
      await callOneBot(scope.bot, 'set_group_add_request', {
        flag,
        sub_type: args.subType,
        approve: args.approve,
        reason: args.reason?.trim() ?? '',
      })
      return `已${verb}${args.subType === 'invite' ? '群邀请' : '加群申请'} ${flag}。`
    },
  },
  setGroupKick: {
    args: Schema.args({
      groupId: groupIdArg(),
      userId: Schema.string().min(1).description('Target member user ID.'),
    }),
    effect: 'write',
    async run(scope, args: { groupId?: string, userId: string }) {
      const groupId = groupOf(scope, args.groupId)
      const userId = required(args.userId, 'userId')
      await callOneBot(scope.bot, 'set_group_kick', { group_id: groupId, user_id: userId })
      return `已将用户 ${userId} 移出群 ${groupId}。`
    },
  },
  setGroupSpecialTitle: {
    args: Schema.args({
      groupId: groupIdArg(),
      userId: Schema.string().min(1).description('Target member user ID.'),
      title: Schema.string().description('New special title. Use an empty string to clear it.'),
    }),
    effect: 'write',
    async run(scope, args: { groupId?: string, userId: string, title: string }) {
      const groupId = groupOf(scope, args.groupId)
      const userId = required(args.userId, 'userId')
      const title = args.title.trim()
      await callOneBot(scope.bot, 'set_group_special_title', { group_id: groupId, user_id: userId, special_title: title })
      return title ? `群专属头衔已更新：${userId} -> ${title}` : `群专属头衔已清除：${userId}`
    },
  },
  deleteMessage: {
    args: Schema.args({
      message_id: Schema.string().min(1).description('Specific message ID to delete.'),
    }),
    effect: 'write',
    async run(scope, args: { message_id: string }) {
      const messageId = required(args.message_id, 'message_id')
      await callOneBot(scope.bot, 'delete_msg', { message_id: numericId(messageId) })
      return `Message deleted by ID ${messageId}.`
    },
  },
}

/** 全部原生工具的定义，名称与描述固定为源插件的默认值。 */
export function nativeToolDefinitions(ctx: Context, config: Config, log: Logger): ToolDefinition[] {
  return NATIVE_TOOL_KEYS.map((key) => {
    const tool = NATIVE_TOOL_IMPLEMENTATIONS[key]
    const { toolName: name, description } = NATIVE_TOOLS[key]
    return {
      name,
      description,
      args: tool.args,
      traits: { effect: tool.effect },
      async run(args: unknown, call: ToolCallContext) {
        const location = call.location
        const bot = oneBotOf(ctx, location?.platform, location?.selfId)
        if (!bot) throw new Error('This tool only supports OneBot platform.')
        try {
          const result = await tool.run({ bot, guildId: location?.isDirect ? undefined : location?.guild, protocol: config.oneBotProtocol }, args)
          log.debug('%s: %s', name, result)
          return result
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.warn('%s failed: %s', name, message)
          throw new Error(`${name} failed: ${message}`)
        }
      },
    }
  })
}

/**
 * 注册原生工具。工具对所有会话全局可见（v2 的工具管理页因此能列出并开关它们），
 * 再给不在 OneBot 上的 agent 挂一层排除过滤，与源插件只在 OneBot 会话授权一致。
 */
export function registerNativeTools(ctx: Context, config: Config, log: Logger) {
  const definitions = nativeToolDefinitions(ctx, config, log)
  for (const definition of definitions) ctx.tools.define(definition)
  const exclude = definitions.map((definition) => definition.name)
  log.info('native tools registered: %s', exclude.join(', '))
  ctx.inject(['agents'], (inner) => {
    const scope = (agent: Agent) => {
      if (agent.options.location?.platform !== 'onebot') inner.tools.filter({ exclude }, agent)
    }
    inner.on('chatluna/agent-open', ({ agent }) => scope(agent))
    for (const agent of inner.agents.list()) scope(agent)
  })
}
