import type { Context } from 'cordis'
import type { Bot } from '@satorijs/core'

/** Koishi OneBot 适配器的原始请求：返回完整的响应包，业务失败也照常 resolve。 */
export interface OneBotInternal {
  _request(action: string, params: Record<string, unknown>): Promise<unknown>
}

interface OneBotEnvelope {
  status?: unknown
  retcode?: unknown
  wording?: unknown
  message?: unknown
  data?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 会话所在的 OneBot 机器人；不是 OneBot 会话或机器人已离线时为 undefined。 */
export function oneBotOf(ctx: Context, platform: string | undefined, selfId: string | undefined): Bot | undefined {
  if (platform !== 'onebot' || selfId === undefined) return undefined
  return ctx.satori.bots.find((bot) => bot.platform === 'onebot' && bot.selfId === selfId)
}

/**
 * 调用 OneBot action 并返回 `data`。OneBot 的业务错误以正常 resolve 的响应包返回，这里按 status 与 retcode
 * 判定失败并抛出，错误信息取实现给出的 wording/message。
 */
export async function callOneBot(bot: Bot, action: string, params: Record<string, unknown>): Promise<unknown> {
  const internal: OneBotInternal = bot.internal
  const result: unknown = await internal._request(action, params)
  if (!isRecord(result)) return result
  const envelope: OneBotEnvelope = result
  const status = String(envelope.status ?? '').toLowerCase()
  const failed = (status !== '' && status !== 'ok') || (typeof envelope.retcode === 'number' && envelope.retcode !== 0)
  if (!failed) return envelope.data
  const reason = envelope.wording || envelope.message || envelope.status
  const retcode = typeof envelope.retcode === 'number' ? ` (retcode: ${envelope.retcode})` : ''
  throw new Error(`${reason ? String(reason) : 'OneBot returned failed'}${retcode}`)
}

/**
 * 整数形式的 ID 转成数字，其余原样保留；OneBot 实现普遍要求数字形式的群号、QQ 号与消息 ID。
 * SnowLuma 的 message_id 是 int32 哈希，常为负数，所以带负号的整数同样转换。
 */
export function numericId(value: string): string | number {
  return /^-?\d+$/.test(value) ? Number(value) : value
}

/** 取第一个非空值（去掉首尾空白后不为空字符串），保留原始类型。 */
export function pickFirst(...values: unknown[]): string | number | undefined {
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (!String(value).trim()) continue
    return typeof value === 'number' ? value : String(value)
  }
  return undefined
}

export function pickText(...values: unknown[]): string {
  return String(pickFirst(...values) ?? '').trim()
}

/** OneBot 时间戳可能是秒或毫秒，统一成毫秒；空值与 0 视为没有。 */
export function normalizeTimestamp(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric === 0) return undefined
  return numeric < 1e11 ? numeric * 1000 : numeric
}

const pad = (value: number) => String(value).padStart(2, '0')

export function formatDate(value: number | undefined): string {
  if (value === undefined) return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateTime(value: number | undefined): string {
  const day = formatDate(value)
  if (!day || value === undefined) return day
  const date = new Date(value)
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 群成员信息的常见字段；各 OneBot 实现与 Satori 的字段名不同，读取时逐个尝试。 */
export interface MemberInfo {
  user_id?: unknown
  userId?: unknown
  id?: unknown
  qq?: unknown
  uid?: unknown
  role?: unknown
  roleName?: unknown
  permission?: unknown
  identity?: unknown
  roles?: unknown
  card?: unknown
  remark?: unknown
  displayName?: unknown
  nick?: unknown
  nickname?: unknown
  name?: unknown
  level?: unknown
  levelName?: unknown
  level_name?: unknown
  level_info?: { current_level?: unknown }
  title?: unknown
  specialTitle?: unknown
  special_title?: unknown
  sex?: unknown
  gender?: unknown
  age?: unknown
  area?: unknown
  region?: unknown
  location?: unknown
  join_time?: unknown
  joined_at?: unknown
  joinTime?: unknown
  joinedAt?: unknown
  last_sent_time?: unknown
  lastSentTime?: unknown
  lastSpeakTimestamp?: unknown
  user?: { nick?: unknown, nickname?: unknown, name?: unknown }
}

export function asMembers(value: unknown): MemberInfo[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

export function asMember(value: unknown): MemberInfo | undefined {
  return isRecord(value) ? value : undefined
}

export function memberUserId(member: MemberInfo): string {
  return pickText(member.user_id, member.userId, member.id, member.qq, member.uid)
}

export function memberCard(member: MemberInfo): string {
  return pickText(member.card, member.remark, member.displayName)
}

export function memberNickname(member: MemberInfo): string {
  return pickText(member.nick, member.nickname, member.name, member.user?.nickname, member.user?.name)
}

export function memberRole(member: MemberInfo): string {
  const roles = Array.isArray(member.roles) ? member.roles : []
  return pickText(member.role, member.roleName, member.permission, member.identity, roles[0])
}
