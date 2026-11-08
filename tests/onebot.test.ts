import { describe, expect, it } from 'vitest'
import type { Bot } from '@satorijs/core'
import { callOneBot } from '../src/onebot'

const call = (response: unknown) => callOneBot({
  internal: { _request: async () => response },
} as Bot, 'get_group_info', { group_id: 20000 })

describe('OneBot 响应包', () => {
  it('成功时返回 data，包含没有返回值的 action', async () => {
    const data = { group_id: 20000, group_name: '测试群' }
    expect(await call({ status: 'ok', retcode: 0, data })).toBe(data)
    expect(await call({ status: 'ok', retcode: 0, data: null })).toBeNull()
  })

  it.each([
    [{ status: 'failed', retcode: 100, wording: '权限不足' }, '权限不足 (retcode: 100)'],
    [{ status: 'ok', retcode: 100, message: '调用失败' }, '调用失败 (retcode: 100)'],
    [{ status: 'failed', retcode: 0 }, 'failed (retcode: 0)'],
  ])('status 或 retcode 表示失败时抛出业务错误：%j', async (response, message) => {
    await expect(call(response)).rejects.toThrow(message)
  })

  it.each([null, [], 'ok', 0, { group_id: 20000 }, { status: 'ok' }, { retcode: 0 }])(
    '不接受缺少标准响应包的返回值：%j',
    async (response) => {
      await expect(call(response)).rejects.toThrow('Invalid OneBot response envelope')
    },
  )
})
