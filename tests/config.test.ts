import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Schema } from '@chatluna/schema'
import { Config, inject } from '../src'

const fieldsOf = (schema: Schema | undefined): Record<string, Schema> =>
  schema?.type === 'intersect' ? Object.assign({}, ...(schema.list ?? []).map(fieldsOf)) : { ...schema?.dict }

/** 递归列出所有字段（含变量分组里的字段），对象分组本身不算字段。 */
function leaves(schema: Schema, path = ''): Array<[string, Schema]> {
  return Object.entries(fieldsOf(schema)).flatMap(([key, field]) => {
    const next = path ? `${path}.${key}` : key
    return field.type === 'object' ? leaves(field, next) : [[next, field] as [string, Schema]]
  })
}

describe('插件配置', () => {
  it('包元数据的服务声明与入口 inject 一致，过滤、唤醒与读取会话图片用的服务只作为可选服务出现', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(manifest.cordis.service.required).toEqual(inject)
    expect(manifest.cordis.service.optional).toEqual(['agents', 'chat', 'chatluna_storage'])
    expect(manifest.license).toBe('MIT')
  })

  it('配置直接在 v2 插件页编辑：字段都可见，按分组出小节标题，不提供编辑工具的配置', () => {
    expect(Config.type).toBe('intersect')
    expect((Config.list ?? []).map((section) => section.meta.description)).toEqual(['基础设置', '变量', '其他设置'])
    expect(leaves(Config).some(([, field]) => field.meta.hidden)).toBe(false)
    expect(leaves(Config).map(([key]) => key).filter((key) => /tool/i.test(key))).toEqual([])
  })

  it('默认值与源插件一致：NapCat 协议、变量名不变，申请通知默认打开', () => {
    const config = Config({})
    expect(config.oneBotProtocol).toBe('napcat')
    expect([config.userInfo.variableName, config.botInfo.variableName, config.groupInfo.variableName, config.groupShutList.variableName])
      .toEqual(['userInfo', 'botInfo', 'groupInfo', 'groupShutList'])
    expect(config.groupInfo.items).toEqual(['groupName', 'groupId', 'memberCount', 'ownerList', 'adminList'])
    expect(config.requestNotice).toBe(true)
    expect(config.debugLogging).toBe(false)
  })

  it('每个字段都有标题，说明符合配置文案规范', () => {
    const fields = leaves(Config)
    expect(fields.length).toBe(10)
    for (const [key, field] of fields) {
      expect((field.meta as { label?: string }).label, key).toMatch(/\S/)
      const text = field.meta.description
      if (typeof text !== 'string') continue
      expect(text, key).not.toMatch(/[。.]$/)
      expect(text, key).not.toMatch(/ `|` /)
    }
  })
})
