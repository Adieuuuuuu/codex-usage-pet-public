# Usage Pet 架构决策

## 手机同步扩展

手机同步只位于 Electron Main：

```text
CodexMonitorSnapshot
  -> privacy projection
  -> sequence + AES-256-GCM
  -> HTTPS PUT to private Cloudflare relay
```

Renderer 只通过白名单 IPC 请求配对状态、生成/复制配对代码和停止同步，不接触
master secret、派生密钥、认证 token 或网络响应。配对文件由 Electron
`safeStorage` 加密；不支持该能力时同步保持关闭，不把明文 secret 降级落盘。

发布器使用完整快照而不是增量补丁，以便手机在重连时一次收敛。Cloudflare
只保存最新密文；手机依据序列拒绝旧消息。网络链路失败与本地 Codex Monitor
隔离，不改变现有任务、用量、提示音和桌宠状态。

状态：已确认第一版架构，2026-07-26。

## 技术栈

采用 Electron + TypeScript + 原生 DOM/CSS。

选择理由：

- 当前目标只运行在 Windows，Electron 已提供透明置顶窗口、托盘、单实例、登录启动、全局鼠标坐标和协议跳转。
- Codex 本地事件与 Hatch Pet 包都是文件/JSON 数据，Node 主进程可以用最少依赖完成。
- 第一版界面组件很少，不引入 React 或大型状态框架；主进程保留纯函数 reducer，便于测试。
- 不使用 Windows Service。Service 位于非交互 Session，不能承载桌宠 UI；本项目以登录启动、托盘常驻、单实例和 renderer 崩溃重建保证可用性。

## 许可证边界

- Clawd on Desk 源码为 AGPL-3.0-only，美术资产另行保留权利。
- 本项目只复用公开行为、协议和架构经验，不复制 Clawd 源码、主题或角色资产。
- 芝麻 3 是用户现有 Codex Hatch Pet 包；用户明确要求它作为初始宠物；运行时优先从 `~/.codex/pets` 读取，因此有效用户安装包会覆盖同一 ID 的内置包。公开快照只分发已获授权的成品 v2 图集，使用 CC BY 4.0；私人参考照片和生成中间件不公开。

## 进程与安全边界

```text
已有 Codex hooks ─> 兼容 hook runner ─> 仅元数据事件文件 ─┐
Codex JSONL ───────────────> RolloutTailer ───────────┤
state_5.sqlite ────────────> ThreadRepository ────────┼─> SessionReducer
Hatch Pet 目录 ────────────> PetPackRegistry ─────────┤
                                                     └─> typed IPC ─> renderer
```

- Main process 持有所有文件、数据库、窗口和系统能力。
- Renderer：`nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`，只使用白名单 preload API。
- IPC 校验 sender、参数、UUID、缩放范围和允许的动作。
- 自定义 `usagepet://` 资源协议只返回已验证宠物包中的 spritesheet。

## Codex 数据源

### 1. 已有 Hook：兼容辅助通道

读取 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PermissionRequest`、`Stop`、`SessionEnd`。Hook runner 只保存：

- 事件名
- thread/session ID
- turn ID
- transcript 路径
- 时间
- 必要的 tool 名称

不保存 tool input、提示词、输出正文和权限决定。应用不再向用户提供 Hook 配置入口，也不会通过 UI 修改 `hooks.json`；安装包暂留 runner，只为避免已经存在的 Usage Pet Hook 在应用更新后指向不存在的兼容资源。

任务提示音不在 Hook runner 中播放。Monitor 额外发布仅含匿名线程 ID 和状态的 `notificationTasks`：它保留已读完成状态供声音判断，但不改变任务列表和完成计数。Renderer 不区分 Hook 或 rollout 来源，只检测 `waiting` / `review` 状态切换，播放本地打包音频并使用 10 秒全局冷却；首次快照只建立基线，不补响历史状态。

### 2. Rollout JSONL：只读状态主通道与额度来源

- `task_started` 且无更晚的 `task_complete`/`turn_aborted`：运行中。
- `request_user_input` 调用尚无输出：等待输入。
- `error`：失败。
- `task_complete`：完成待查看。
- `token_count.payload.rate_limits`：额度窗口。

额度从所有窗口中按最大 `window_minutes` 选择周窗口，显示 `100 - used_percent`；不假设 primary/secondary 的固定意义。记录 `capturedAt`，reset 已过但没有新事件时显示不可用，不擅自重置成 100%。

### 3. state_5.sqlite：线程元数据

只读查询 `source='vscode' AND archived=0` 的根任务，获取 UUID、标题、更新时间和 rollout 路径。运行状态不从该表推断。

### 4. App Server：可选富化

独立 app-server 不能保证附着正在运行的 Codex Desktop；当前本机独立实例也没有 Desktop 账号认证。第一版不把它作为状态或额度真源。

## 状态模型

内部状态：

- `idle`
- `running`
- `waiting`
- `review`
- `failed`

显示优先级：`failed > waiting > review > running > idle`。本地拖拽、点击和首次唤醒作为短暂动画覆盖；覆盖结束后返回 reducer 的最新业务状态。

Hook 与 JSONL 对同一 thread 合并时，优先采用时间更新且语义更精确的事件。Hook 长时间缺失时不会永久锁定状态；`task_complete`、`turn_aborted` 或新的 `task_started` 会收敛。

## Hatch Pet 兼容

- v1：`1536x1872`，8x9，`192x208` cells。
- v2：`1536x2288`，8x11，`spriteVersionNumber: 2`；rows 9-10 为 16 向注视。
- 先验证 manifest、相对路径、目录 containment 和图片尺寸，再交给 renderer。
- v2 在 idle 时按全局鼠标相对宠物中心的角度选择 16 向 cell；deadzone 内回到 idle loop。
- v1 保留 0-8 动画，无法可靠实现 16 向注视时不伪造眼睛图层。
- 每次启动自动扫描宠物目录，也可从托盘手动重新扫描；当前选择失效时回退到内置芝麻 3。

## 窗口与交互

桌宠主视图使用单个紧凑透明窗口，而不是 Clawd 的双窗口；仅在右键时创建一个固定尺寸的临时菜单窗口：

- 本产品右侧始终有实体用量胶囊，窗口不存在大片需要 click-through 的透明区域。
- 单窗口能减少 hover、拖动、展开面板之间的 IPC 同步和焦点错位。
- 右键菜单不能使用点击后必然关闭的系统原生菜单模拟连续缩放；临时菜单窗口使用屏幕全局锚点、固定逻辑尺寸和独立白名单 preload，缩放只改变桌宠主窗口。
- Renderer 使用 pointer capture；Main 以拖拽开始时的全局鼠标和窗口快照移动窗口。
- 面板展开时根据当前显示器工作区向下或向上扩展，避免越界。

如后续加入大尺寸自由形宠物，再评估独立 click-through render window + shaped hit window。

## 任务跳转

对通过 UUID 校验的线程使用官方 `codex://threads/<thread-id>`。协议调用失败时降级为唤醒 Codex 主入口；不在任务胶囊里加入批准、暂停、取消或回复动作。

## 常驻与恢复

- `app.requestSingleInstanceLock()` 防止重复实例。
- 关闭主窗收起到托盘；“退出”才结束进程。
- `render-process-gone` 时重建 renderer。
- 登录启动使用 `app.setLoginItemSettings`，默认不擅自启用。
- Codex 启动联动以登录常驻 + Codex 进程/文件检测为默认路径；已有 `SessionStart` hook 仅作为向后兼容的额外唤醒通道。
