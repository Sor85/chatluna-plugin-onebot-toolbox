import { Schema } from '@chatluna/schema'

export type OneBotProtocol = 'napcat' | 'llbot' | 'snowluma'

export type NativeToolKey =
  | 'setSelfProfile'
  | 'setQQAvatar'
  | 'setGroupCard'
  | 'searchGroupMember'
  | 'leaveGroup'
  | 'handleRequest'
  | 'setGroupKick'
  | 'setGroupSpecialTitle'
  | 'deleteMessage'

export interface NativeToolInfo {
  toolName: string
  description: string
}

export type MemberInfoItem =
  | 'userId'
  | 'nickname'
  | 'role'
  | 'level'
  | 'title'
  | 'gender'
  | 'age'
  | 'area'
  | 'joinTime'
  | 'lastSentTime'

export type GroupInfoItem = 'groupName' | 'groupId' | 'memberCount' | 'createTime' | 'ownerList' | 'adminList'

export interface Config {
  oneBotProtocol: OneBotProtocol
  requestNotice: boolean
  userInfo: { variableName: string, items: MemberInfoItem[] }
  botInfo: { variableName: string, items: MemberInfoItem[] }
  groupInfo: { variableName: string, items: GroupInfoItem[] }
  groupShutList: { variableName: string }
  debugLogging: boolean
}

/**
 * 原生工具的名称与描述，与源插件的默认值一致。插件不提供改名、改描述或开关工具的配置，
 * 工具全部注册，启用范围交给 v2 的工具管理。
 */
export const NATIVE_TOOLS: Record<NativeToolKey, NativeToolInfo> = {
  setSelfProfile: {
    toolName: 'set_self_profile',
    description: '修改自己的 QQ 资料，可设置昵称、签名和性别。',
  },
  setQQAvatar: {
    toolName: 'set_qq_avatar',
    description: '修改机器人 QQ 头像。提供 imageUrl；HTTP/HTTPS 图片会先由插件读取并转为 OneBot base64 文件，避免临时 URL 过期或 OneBot 端无法访问。',
  },
  setGroupCard: {
    toolName: 'set_group_card',
    description: '修改群成员的群昵称。',
  },
  searchGroupMember: {
    toolName: 'search_group_member',
    description: '根据 qqid 精确查询群成员的群昵称与 QQ 昵称，或根据群昵称/QQ 昵称搜索 qqid。默认查询当前群聊，可通过 groupId 查询指定群。',
  },
  leaveGroup: {
    toolName: 'set_group_leave',
    description: '让机器人退出当前群聊。',
  },
  handleRequest: {
    toolName: 'handle_request',
    description: '根据 OneBot 申请 flag 同意或拒绝好友申请、加群申请或群邀请。',
  },
  setGroupKick: {
    toolName: 'set_group_kick',
    description: '将指定成员踢出群聊。',
  },
  setGroupSpecialTitle: {
    toolName: 'set_group_special_title',
    description: '修改或清除群成员的 QQ 群专属头衔。',
  },
  deleteMessage: {
    toolName: 'delete_msg',
    description: '根据消息 ID 撤回指定消息。',
  },
}

export const NATIVE_TOOL_KEYS = Object.keys(NATIVE_TOOLS) as NativeToolKey[]

export const DEFAULT_MEMBER_INFO_ITEMS: MemberInfoItem[] = [
  'nickname', 'userId', 'role', 'level', 'title', 'gender', 'age', 'area', 'joinTime', 'lastSentTime',
]

export const DEFAULT_GROUP_INFO_ITEMS: GroupInfoItem[] = ['groupName', 'groupId', 'memberCount', 'ownerList', 'adminList']

/** 变量名须满足 v2 模板的变量命名规则（`@chatluna/prompt` 的 `variable`），留空表示不注册。 */
const VARIABLE_NAME = /^([a-z_][a-z0-9_]*)?$/i

const memberItems = (subject: string) => Schema.array(Schema.union([
  Schema.const('userId').description(`${subject} ID`),
  Schema.const('nickname').description('群昵称'),
  Schema.const('role').description('群内身份'),
  Schema.const('level').description('群等级'),
  Schema.const('title').description('群头衔'),
  Schema.const('gender').description('性别'),
  Schema.const('age').description('年龄'),
  Schema.const('area').description('地区'),
  Schema.const('joinTime').description('入群时间'),
  Schema.const('lastSentTime').description('最后发言时间'),
])).role('checkbox').default([...DEFAULT_MEMBER_INFO_ITEMS])

const variableName = (name: string) => Schema.string().default(name).pattern(VARIABLE_NAME).extra('label', '变量名称')
  .description('在预设中以`{变量名称}`引用，留空时不注册')

const basicFields = {
  oneBotProtocol: Schema.union([
    Schema.const('napcat').description('NapCat'),
    Schema.const('llbot').description('LLBot'),
    Schema.const('snowluma').description('SnowLuma'),
  ]).default('napcat').role('radio').extra('label', 'OneBot 协议')
    .description('按所选实现调整请求参数：LLBot 不支持设置性别，群禁言列表的群号类型也不同；SnowLuma 同意好友申请后另行设置备注'),
  requestNotice: Schema.boolean().default(true).extra('label', '申请通知')
    .description('收到好友申请、加群申请或群邀请时唤醒对应会话，把申请 flag 告诉模型，供`handle_request`工具处理。好友申请与群邀请发往申请人的私聊，加群申请发往所申请的群；该工具在工具管理中禁用时不唤醒'),
}

const variableFields = {
  userInfo: Schema.object({
    variableName: variableName('userInfo'),
    items: memberItems('用户').extra('label', '信息项').description('选择用户信息变量中显示的详细信息项'),
  }).description('用户信息变量').collapse(),
  botInfo: Schema.object({
    variableName: variableName('botInfo'),
    items: memberItems('机器人').extra('label', '信息项').description('选择机器人信息变量中显示的详细信息项'),
  }).description('机器人信息变量').collapse(),
  groupInfo: Schema.object({
    variableName: variableName('groupInfo'),
    items: Schema.array(Schema.union([
      Schema.const('groupName').description('群名称'),
      Schema.const('groupId').description('群号'),
      Schema.const('memberCount').description('成员数量'),
      Schema.const('createTime').description('创建时间（仅部分实现支持）'),
      Schema.const('ownerList').description('群主名单'),
      Schema.const('adminList').description('管理员名单'),
    ])).role('checkbox').default([...DEFAULT_GROUP_INFO_ITEMS]).extra('label', '信息项')
      .description('选择群信息变量中显示的群信息项'),
  }).description('群信息变量').collapse(),
  groupShutList: Schema.object({
    variableName: variableName('groupShutList'),
  }).description('群禁言列表变量').collapse(),
}

const otherFields = {
  debugLogging: Schema.boolean().default(false).extra('label', '输出调试日志')
    .description('以 info 级别输出工具调用与变量解析的调试信息'),
}

/**
 * 插件配置，直接在 v2 的插件设置页编辑。顶层是分组的 intersect，SchemaForm 把每组的 description 渲染成小节标题；
 * 每个字段都写 `extra('label')`，缺 label 时 SchemaForm 会把配置键当标题显示。
 */
export const Config: Schema<Config> = Schema.intersect([
  Schema.object(basicFields).description('基础设置'),
  Schema.object(variableFields).description('变量'),
  Schema.object(otherFields).description('其他设置'),
])
