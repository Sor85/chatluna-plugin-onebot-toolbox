# AGENTS.md — chatluna-plugin-onebot-toolbox

ChatLuna v2 外部插件：为 ChatLuna 提供 OneBot 原生工具与群聊信息变量，配置直接在 v2 的插件设置页编辑。仅对接当前 v2 API，不保留旧版本配置、字段别名或调用方式的兼容层；NapCat、LLBot、SnowLuma 当前协议差异仍需按实现处理。

## 位置与依赖

- 本仓库是插件的唯一源码。`@chatluna/*` 未发布到 npm，只能在 ChatLuna v2 仓库（`chatluna-v2-mirror`）里以 workspace 成员 `external/onebot-toolbox` 的身份解析、构建和运行。
- 源码经 `scripts/sync-to-v2.mjs` 单向同步到 `external/onebot-toolbox`（`node scripts/sync-to-v2.mjs --once` 同步一次，不带参数持续监听；本仓库没有安装依赖，用 node 直接运行，不经 yarn）。副本里的 `node_modules`、`lib`、`dist`、`data` 只属于副本；其余文件以本仓库为准，只在本仓库里改。v2 仓库位置默认 `../../chatluna-v2-mirror`，可用 `CHATLUNA_V2_ROOT` 覆盖。
- 依赖范围：`@chatluna/*` 在 devDependencies 用 `workspace:*`；运行时有值导入的 `@chatluna/schema`、`@chatluna/message` 进 peerDependencies（`>=2.0.0-alpha.0`），其余只做类型导入。协议为 MIT。

## 目录

- `src/config.ts`：配置。`Config` 是分组的 intersect（基础设置、变量、其他设置），由 v2 插件设置页直接渲染；`NATIVE_TOOLS` 是每个工具固定的名称与描述。
- `src/tools.ts`：9 个原生工具（`NATIVE_TOOL_IMPLEMENTATIONS`）与注册。
- `src/variables.ts`：`userInfo`、`botInfo`、`groupInfo`、`groupShutList` 四个变量。
- `src/requests.ts`：申请通知。
- `src/onebot.ts`：机器人查找、OneBot action 调用（`callOneBot`）与成员字段读取。
- `tests/`：vitest。`helpers/host.ts` 装上真实的 Satori、`@chatluna/tool` 与 `@chatluna/prompt` 服务和一个记录 action 的假 OneBot 机器人。

## 约定

- 戳一戳、消息表情、禁言由 v2 自带的 `@chatluna/chat-onebot` 动作（`<poke/>`、`<react/>`、`<mute/>`）提供；`random` 变量也由 v2 提供，本插件不重复注册。
- 插件不提供编辑工具的配置（开关、改名、改描述），交给 v2 的工具管理：9 个工具在插件启用时全部按 `NATIVE_TOOLS` 的名称与描述注册。
- 工具全局注册（v2 工具管理页才能列出），再在 `chatluna/agent-open` 时给不在 OneBot 上的 agent 挂 `tools.filter({ exclude })`；`agents` 是可选服务，没有时工具对所有会话可见、调用时报不支持。
- 工具的执行上下文取 `call.location`（platform、selfId、guild、isDirect），机器人经 `ctx.satori.bots` 按 selfId 查找，不经 `chat.inbound`。失败一律抛 Error（消息为 `<工具名> failed: <原因>`），v2 只把 message 交给模型。OneBot 的业务失败以正常 resolve 的响应包返回，统一经 `callOneBot` 按 status/retcode 判定，不用适配器的 `_get`。
- 群号、QQ 号多数以字符串提交，`delete_msg`、`get_group_member_list`、成员与群信息查询转成数字；LLBot 的 `set_qq_profile` 不带 `sex`；`get_group_shut_list` 按协议使用 NapCat/SnowLuma 的数字或 LLBot 的字符串群号，不猜测其他类型重试，200ms 超时按空列表处理。
- 成员与群信息只读取 OneBot 正式字段，不猜测 camelCase、Satori 或历史字段别名；其他平台的 `GuildMember` 在 `fetchMember` 入口按当前 Satori 类型显式转换。群人数只用 `member_count`，不能用容量 `max_member_count` 代替。
- SnowLuma：`set_friend_add_request` 不读 `remark`，同意后另调 `set_friend_remark`（申请通知因此把 `userId` 写进唤醒原因）；`message_id` 是常为负数的 int32 哈希，`numericId` 接受带负号的整数；`get_group_info` 的创建时间字段是 `group_create_time`。`get_group_shut_list` 返回 `{user_id, nickname, shut_up_time}`，由 `renderShutItem` 与 NapCat/LLBot 的字段差异一并处理。
- 权限不另定义，走 v2 默认的 `tool:<名称>`（`search_group_member` 是 read，其余是 write）。
- 头像工具的图片来源：v2 不把聊天图片的地址交给模型，只给 `<img ref="i…"/>` 占位符，所以 `imageUrl` 除了 HTTP/HTTPS 与本地路径还接受 ref。ref 用 `@chatluna/message` 的 `fileRefTableOf(call.agent.session.messages()).resolve(ref)` 解析（与 v2 的 `look` 工具同一张表，该运行时依赖列入 peerDependencies），取原图 `data` 而不是 `preview`；`storage://` 引用经可选服务 `chatluna_storage` 的 `getTempFile` 读出字节，不写进 `inject`（没装存储插件时会话里只有 url 或 data 块）。读出的图片一律转成 `base64://` 提交。
- 变量都声明为 `mutable: true`：随群聊状态变化，写在 system 区会报 `MutableVariableError`。provider 拿不到 Session，只有 `PromptEnvironment`；群聊里 `env.userId` 只来自本步最新的用户消息，退回 `env.message.senderId`。变量名被其他插件占用时只跳过该变量并记 warn。
- 申请通知：v2 不把 OneBot 申请事件交给模型，`handle_request` 拿不到 flag 就无法使用，所以在 `requestNotice` 打开时经 `chat.wake` 以路由身份唤醒（会话不存在时新开）。唤醒前用不带 agent 的 `tools.list()` 确认 `handle_request` 仍可见：v2 工具管理页的禁用由 `@chatluna/tool-policy` 落成全局 `exclude` 过滤，工具被禁用时不唤醒，免得模型去调一个用不了的工具；按路由或 agent 收窄的工具范围在唤醒前拿不到 agent，不在此判断。好友申请与群邀请发往申请人的私聊，加群申请发往所申请的群；路由关闭或没选模型时 `wake` 报错，只记调试日志。
- 配置不另做 WebUI 页面，也不在侧栏加入口：v2 插件设置页直接渲染 `Config`。SchemaForm 只认字符串文案，所以配置文案只有中文；顶层每组用 `.description()` 出小节标题，每个字段都写 `extra('label')`，说明不以句号结尾，反引号前后不加空格（`tests/config.test.ts`）。插件页的「使用说明」标签显示 README，配置项之外的说明（变量用法）写在 README 里。

## 命令

先在本仓库执行 `node scripts/sync-to-v2.mjs --once`，再在 v2 仓库执行：

- 构建（v2 根目录）：`yarn yakumo build onebot-toolbox`
- 测试（`external/onebot-toolbox` 目录）：`../../node_modules/.bin/vitest run`
- 类型检查（`external/onebot-toolbox` 目录）：`../../node_modules/.bin/tsc -p tsconfig.json --noEmit`
- 首次加入 v2 后在 v2 根目录执行一次 `yarn install`，并在 chatluna.yml 的 `extensions` 分组里加上 `name: chatluna-plugin-onebot-toolbox` 条目。

## 发布

`node scripts/publish.mjs`（`--dry-run` 演练，`--otp=<验证码>` 两步验证）。脚本要求工作区干净、提交已推送；它同步到 v2 副本、清空 `lib` 与 `tsconfig.tsbuildinfo` 后构建并测试，`yarn pack` 打包、解压后从目录 `npm publish`，再打 `v<版本>` tag。
