# chatluna-plugin-onebot-toolbox

ChatLuna v2 插件：为 ChatLuna 提供 OneBot（QQ）原生工具与群聊信息变量，仅支持 OneBot 平台（NapCat、LLBot、SnowLuma）。由 Koishi 插件 `koishi-plugin-chatluna-toolbox` 迁移而来。

## 功能

### 原生工具

注册给模型调用的工具，只在 OneBot 会话中提供。插件启用后全部注册，开关与可用范围在 ChatLuna 的工具管理中设置：

| 工具 | 默认名称 | OneBot action |
| --- | --- | --- |
| 修改自身账户信息（昵称、签名、性别） | `set_self_profile` | `set_qq_profile` |
| 修改 QQ 头像 | `set_qq_avatar` | `set_qq_avatar` |
| 修改群成员昵称 | `set_group_card` | `set_group_card` |
| 搜索群成员（按 qqid、群昵称或 QQ 昵称） | `search_group_member` | `get_group_member_list` |
| 退群 | `set_group_leave` | `set_group_leave` |
| 处理好友与群申请 | `handle_request` | `set_friend_add_request` / `set_group_add_request` |
| 踢出群成员 | `set_group_kick` | `set_group_kick` |
| 修改群成员专属头衔 | `set_group_special_title` | `set_group_special_title` |
| 撤回消息 | `delete_msg` | `delete_msg` |

- QQ 头像工具会把 HTTP/HTTPS 图片先读成 OneBot `base64://` 文件再提交，避免 OneBot 端访问不到临时图片地址。
- SnowLuma 同意好友申请时不读取备注，插件在同意后另用 `set_friend_remark` 设置；它的消息 ID 常为负数，撤回消息工具按原样提交。
- 收到好友申请、加群申请或群邀请时插件会唤醒对应会话，把申请 flag 告诉模型，由 `handle_request` 处理：好友申请与群邀请发往申请人的私聊，加群申请发往所申请的群。可在设置中关闭「申请通知」。
- 戳一戳、消息表情回应与禁言由 ChatLuna v2 自带的 OneBot 动作（`<poke/>`、`<react/>`、`<mute/>`）提供，本插件不再重复实现。
- 工具默认对所有用户开放，与原插件一致；如需收紧，在 ChatLuna 的权限页按 `tool:<工具名>` 设置。

### 变量

在预设中引用，渲染时向 OneBot 查询：

- `{userInfo}`：当前用户的群昵称、身份、等级、头衔、性别、年龄、地区、入群与最后发言时间
- `{botInfo}`：机器人在当前群的同类信息
- `{groupInfo}`：群名、群号、成员数量、创建时间、群主与管理员名单
- `{groupShutList}`：当前群被禁言的成员与解除时间（缓存 15 秒）

这些变量随群聊状态变化，只能写在预设的上下文或输入区，不能写在 system 区；v1 格式的预设由 ChatLuna 自动迁移。随机数使用 ChatLuna 自带的 `{random(最小值, 最大值)}`。

原插件的 Character XML 工具不再提供：ChatLuna v2 的角色引擎已经原生支持这类动作。

## 安装

在 ChatLuna v2 的插件市场搜索 `onebot-toolbox` 安装，或在项目目录执行：

```sh
yarn add chatluna-plugin-onebot-toolbox
```

启用插件后，在 WebUI「插件设置」页选中本插件编辑配置。

## License

MIT
