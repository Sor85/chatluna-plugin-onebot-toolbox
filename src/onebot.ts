import type { Context } from 'cordis'
import type { Bot } from '@satorijs/core'

/** OneBot 适配器的原始请求返回完整响应包，业务失败也照常 resolve。 */
interface OneBotInternal {
  _request(action: string, params: Record<string, unknown>): Promise<unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 会话所在的 OneBot 机器人；不是 OneBot 会话或找不到机器人时为 undefined。 */
export function oneBotOf(ctx: Context, platform: string | undefined, selfId: string | undefined): Bot | undefined {
  if (platform !== 'onebot' || selfId === undefined) return undefined
  return ctx.satori.bots.find((bot) => bot.platform === 'onebot' && bot.selfId === selfId)
}

/** 调用 OneBot action 并返回 data，按响应包的 status 与 retcode 判定业务失败。 */
export async function callOneBot(bot: Bot, action: string, params: Record<string, unknown>): Promise<unknown> {
  const internal: OneBotInternal = bot.internal
  const result = await internal._request(action, params)
  if (!isRecord(result) || typeof result.status !== 'string' || typeof result.retcode !== 'number') {
    throw new Error('Invalid OneBot response envelope')
  }
  if (result.status === 'ok' && result.retcode === 0) return result.data
  const reason = result.wording || result.message || result.status || 'OneBot returned failed'
  throw new Error(`${String(reason)} (retcode: ${result.retcode})`)
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

/** OneBot 使用秒，Satori 使用毫秒，统一成毫秒；空值与 0 视为没有。 */
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

/** OneBot 群成员信息；其他平台的 Satori 成员信息在查询入口显式转换。 */
export interface MemberInfo {
  user_id?: unknown
  role?: unknown
  card?: unknown
  nickname?: unknown
  level?: unknown
  title?: unknown
  sex?: unknown
  age?: unknown
  area?: unknown
  join_time?: unknown
  last_sent_time?: unknown
}

export function asMembers(value: unknown): MemberInfo[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}
