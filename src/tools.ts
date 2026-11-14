import type { Context } from 'cordis'
import type { Bot } from '@satorijs/core'
import { Schema } from '@chatluna/schema'
import type { ToolCallContext, ToolDefinition } from '@chatluna/tool'
import type { Agent } from '@chatluna/agent'
import type { ChatFileBlock, ChatMessage } from '@chatluna/message'
import { fileRefTableOf } from '@chatluna/transform'
import type {} from '@chatluna/storage-files'
import type { Config, NativeToolKey, OneBotProtocol } from './config'
import { NATIVE_TOOL_KEYS, NATIVE_TOOLS } from './config'
import type { Logger } from './logger'
import {
  asMembers,
  callOneBot,
  pickText,
  numericId,
  oneBotOf,
  type MemberInfo,
} from './onebot'

/** 工具执行时的上下文：会话所在的机器人与群。 */
export interface ToolScope {
  ctx: Context
  bot: Bot
  /** 会话所在群；私聊为 undefined。 */
  guildId?: string
  protocol: OneBotProtocol
  /** 发起调用的 agent（`call.agent`），用来在会话日志里解析图片 ref；脱离会话的调用没有。 */
  agent?: object
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

const STORAGE_PREFIX = 'storage://'
/** v2 给模型的文件占位符 `<img ref="i…"/>`：`i` 加内容哈希的最短唯一前缀（至少 6 位）。 */
const FILE_REF = /^i[0-9a-f]{6,}$/

const base64File = (buffer: Buffer) => `base64://${buffer.toString('base64')}`

/** HTTP/HTTPS 图片先读成 base64：OneBot 端常访问不到临时 URL，或 URL 在提交前就已过期。 */
async function remoteFile(url: string): Promise<string> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return base64File(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    throw new Error(`无法读取头像图片：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 入站图片由 v2 下载进 `chatluna_storage`，24 小时后过期；没装存储插件时会话里只有 url 或 data 块。 */
async function storageFile(ctx: Context, reference: string): Promise<string> {
  const storage = ctx.get('chatluna_storage')
  if (!storage) throw new Error(`Cannot read ${reference}: the chatluna_storage service is not loaded.`)
  const file = await storage.getTempFile(reference.slice(STORAGE_PREFIX.length))
  if (!file) throw new Error(`${reference} is not in storage (it may have expired).`)
  return base64File(await file.data)
}

function dataFile(data: string): string {
  if (!data.startsWith('data:')) return `base64://${data}`
  const comma = data.indexOf(',')
  const body = data.slice(comma + 1)
  return data.slice(0, comma).endsWith(';base64') ? `base64://${body}` : base64File(Buffer.from(decodeURIComponent(body)))
}

function messagesOf(agent: object | undefined): readonly ChatMessage[] | undefined {
  const session: unknown = agent && 'session' in agent ? agent.session : undefined
  if (session === null || typeof session !== 'object' || !('messages' in session) || typeof session.messages !== 'function') return undefined
  return session.messages() as readonly ChatMessage[]
}

/**
 * v2 不把聊天图片的地址交给模型，只给 `<img ref="i…"/>`，ref 要在发起调用的 agent 的会话日志里按内容哈希解析
 * （与 v2 自带的 `look` 工具、出站 `<img ref>` 同一张表）。
 */
async function sessionImageFile(scope: ToolScope, ref: string): Promise<string> {
  const messages = messagesOf(scope.agent)
  if (!messages) throw new Error(`Image ref ${ref} can only be resolved inside a conversation.`)
  const block: ChatFileBlock | undefined = fileRefTableOf(messages).resolve(ref)
  if (!block) throw new Error(`Image ref ${ref} is not in this conversation.`)
  if (!block.mediaType.startsWith('image/')) throw new Error(`ref ${ref} is ${block.mediaType}, not an image.`)
  // 用原图 data，不用写入时压缩的 preview。
  const { data } = block
  if (data.type === 'data') return dataFile(data.data)
  if (data.type === 'url') return remoteFile(data.url)
  if (data.type === 'reference' && data.reference.startsWith(STORAGE_PREFIX)) return storageFile(scope.ctx, data.reference)
  throw new Error(`Image ref ${ref} cannot be read.`)
}

/** 头像来源：会话图片 ref、`storage://`、HTTP/HTTPS 图片都先读成 base64 再提交，其余（OneBot 端可读的本地路径）原样提交。 */
async function avatarFile(scope: ToolScope, image: string): Promise<string> {
  if (FILE_REF.test(image)) return sessionImageFile(scope, image)
  if (image.startsWith(STORAGE_PREFIX)) return storageFile(scope.ctx, image)
  if (/^https?:\/\//i.test(image)) return remoteFile(image)
  return image
}

function formatMember(index: number, member: MemberInfo): string {
  return `${index}. qqid：${pickText(member.user_id) || '未知'}，群昵称：${pickText(member.card) || '无'}，QQ昵称：${pickText(member.nickname) || '无'}`
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
      return '资料已更新。'
    },
  },
  setQQAvatar: {
    args: Schema.args({
      imageUrl: Schema.string().min(1).description('The image: the ref attribute of an `<img ref="i…"/>` in this conversation, an HTTP/HTTPS URL, or a local file path readable by the OneBot side.'),
    }),
    effect: 'write',
    async run(scope, args: { imageUrl: string }) {
      const file = await avatarFile(scope, required(args.imageUrl, 'imageUrl'))
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
        ? pickText(member.user_id) === query
        : [pickText(member.card), pickText(member.nickname)].some((name) => name && name.toLowerCase().includes(keyword)))
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
}

/** 全部原生工具的定义，名称与描述统一取自 NATIVE_TOOLS。 */
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
          const result = await tool.run({ ctx, bot, guildId: location?.isDirect ? undefined : location?.guild, protocol: config.oneBotProtocol, agent: call.agent }, args)
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
 * 再给不在 OneBot 上的 agent 挂一层排除过滤。
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
