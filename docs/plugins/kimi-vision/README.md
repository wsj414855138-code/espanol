# dsh-plugin-kimi-vision · Kimi 视觉桥

让 DSH 里的 **DeepSeek 也能"读"图片**：你在聊天里粘贴/拖拽图片发给模型时，插件自动调用 **Kimi 视觉模型**（通过 `pi` CLI，复用 `~/.pi` 里已有的 kimi-coding OAuth）把图片描述成文字，注入模型请求——DeepSeek 收到的是文字版描述，照常回答；聊天记录里你的原图照常显示。

- **零 npm 依赖**：只用 Node 内置模块 + `pi` CLI。
- **无需改模型**：主模型还是 DeepSeek，Kimi 只做"看图"这一步。
- **原生看图模型不受影响**：如果切到 kimi-coding/k3 这类本身支持图片的模型，图片会原样透传，不走描述桥。

## 工作原理（三个钩子）

| 钩子 | 作用 |
|---|---|
| `ctx.llm.resolveModelInfo`（运行时补丁） | DSH 的 `session.prompt` 在图片消息入队前会检查模型是否支持图片（`inputModalities`），DeepSeek 只报 `["text"]` 会被直接拒绝（"当前模型不支持图片"）。插件把只支持文本的模型上报为 `["text","image"]`，让图片消息能进入对话。 |
| `llm/stream`（waterfall 监听） | 请求即将发给模型时，若消息里含图片块且目标模型是纯文本模型，逐张调 Kimi 识别，把图片块替换成 `[📷 文件名 · Kimi 视觉识别] <描述>` 文本块。**只改写发往模型的请求**，会话日志里的原图原样保留。 |
| 描述缓存 | 按附件 id（sha256）缓存描述（内存 + `cache.json` 落盘），同一张图后续步骤/重试秒回，不重复花钱。 |

## 文件位置

```
~/.dsh/profiles/web/
├── cordis.patch.yml                    ← 插件注册入口（热加载）
└── plugins/kimi-vision/
    ├── package.json                    ← type: module
    ├── index.js                        ← 插件本体（本目录是镜像，live 副本在此）
    └── .status.json                    ← 激活心跳（applied / error）
```

> `cordis.patch.yml` 被 DSH 热加载（watchUserPatches）：改配置保存即生效，**无需重启**。
> 本目录是仓库镜像；live 副本在 `~/.dsh/profiles/web/plugins/kimi-vision/`。改代码请两边同步。

## 配置项（cordis.patch.yml → config）

| 键 | 默认 | 说明 |
|---|---|---|
| `model` | `kimi-coding/kimi-for-coding` | 识图模型。**实测基准（2026-08-15，直连 HTTP + 关思考 + 紧凑提示词）**：K2.7 ≈7.8~8.5s（最快且最便宜 $0.95/$4）；k3 ≈10.6s（价 3 倍）；highspeed、k3-256k ≈13s。**K2.6 不存在**（coding 端点只有 kimi-for-coding / highspeed / k3 / k3-256k 四个，K2.6 是 Kimi App 里的旧名，K2.7 即 K2 系列最高） |
| `endpoint` | `https://api.kimi.com/coding/v1/chat/completions` | OpenAI 兼容端点。以后接千问/豆包直接改这里 + `model` + `apiKey` 即可 |
| `apiKey` | 空 | 直接 Bearer API Key；为空时自动用 `~/.pi/agent/auth.json` 的 kimi-coding OAuth token |
| `language` | `zh` | 描述语言：`zh` / `es` / `en` |
| `piBin` | 自动探测 | pi CLI 路径（PATH → `~/.local/share/pi-node/*/bin/pi`） |
| `sessionDir` | `$TMPDIR/dsh-kimi-vision` | pi 会话文件临时目录（与 ~/.pi 的历史会话隔离） |
| `cwd` | 同上 | pi 的工作目录。**设成项目目录即可让识图对话续上该项目在 ~/.pi/agent/sessions 里的过往 json 会话**（"过往 json"开关） |
| `timeoutMs` | `180000` | 单张图识别的超时 |
| `maxParallel` | `4` | 同时识别的图片数 |
| `maxDescriptionChars` | `4000` | 单张图描述注入的上限字符数 |
| `maxContextChars` | `2000` | 随图片带给 Kimi 的用户消息上下文上限 |
| `transport` | `auto` | 识图通道：`http`（直连 Kimi API，快）｜`pi`（CLI 兜底）｜`auto`（http 优先，失败自动回退 pi） |
| `disableThinking` | `true` | 发 `thinking: {type:"disabled"}`：K2.7 带图时默认先输出大段思考（reasoning_content）再出描述，关掉后首个描述 token 提前约一半（实测 6.2s→3.2s） |
| `abortAfterChars` | `1200` | 流式识别时描述达到该字符数即中断（0=不截断）；文字密集的图可调大保完整 |
| `prefetchOnInsert` | `true` | 图片一进 agent 收件箱就开识（与 pre-step/组包并行，省约 1s） |
| `noTools` | `true` | 用 `--no-tools` 跑 pi：Kimi 不能调 bash 工具（否则它可能在宿主最小 PATH 下跑 `node` 失败：`bash: node: command not found`） |
| `piExtraArgs` | `[]` | 附加 pi CLI 参数 |
| `ensureNodeInPiBin` | `true` | 把 node/npm/npx 软链进 `~/.pi/agent/bin`（pi 的 bash 工具环境会优先用它），保证 pi 内部任何 bash 都能找到 node |
| `extendHostPath` | `true` | 把 pi-node bin 目录加到**宿主进程** PATH——DSH 的 bash 工具继承宿主环境（默认只有 `/usr/bin:/bin:/usr/sbin:/sbin`），加了之后 agent 在 bash 里也能直接跑 `node`/`pi`（否则 `bash: node: command not found`） |

## 已知故障与修复（2026-08-15）

**症状**：发图后出现 `图片解码失败: bash: node: command not found`（可能是聊天里模型转述的 bash 失败）。

**根因（两层）**：DSH 宿主由 Electron 启动，PATH 只有系统默认（`/usr/bin:/bin`），DSH 的 bash 工具也继承这个最小 PATH：
1. pi 里的 Kimi 会调 pi 的 **bash 工具**跑 `node ...` 分析图片，bash 里找不到 node；
2. 你在聊天里让 agent"看这张图"时，agent 想跑 `node scripts/vision-review.mjs ...` 也会撞上同样的 `bash: node: command not found`。

**修复（已热加载生效，pid 验证 = live 宿主）**：
1. pi 带 `--no-tools` 运行——Kimi 不再有 bash 工具，这类失败从根上不可能发生；
2. 插件把 node/npm/npx 软链进 `~/.pi/agent/bin`（pi 自己的辅助 bin 目录）——任何 pi 派生的 bash 都能找到 node；
3. 插件把 pi-node bin 目录**加进宿主进程 PATH**——DSH bash 工具（继承宿主环境）现在直接能跑 `node` 和 `pi`，agent 用 `scripts/vision-review.mjs` 也不会再报 command not found；
4. 失败/心跳会写 `~/.dsh/profiles/web/plugins/kimi-vision/.diagnostics.log` 和 `.heartbeat.log`，再出问题先看这两个文件。

## 安装 / 卸载 / 排障

```bash
# 卸载：把 cordis.patch.yml 里 kimi-vision 那段删掉（或把 id 换成新值），保存即热卸载
# 备份：cordis.patch.yml.bak-* 是安装前备份
```

- **验证激活**：`cat ~/.dsh/profiles/web/plugins/kimi-vision/.status.json` → `"applied": true`。
- **插件升级后不生效**：`name` 带 `?r=N` 查询串用于破除 Node 模块缓存；改了插件代码后把 `?r=` 的数字 +1，保存 patch 即重新加载。
- **识别失败**：图片块会被替换为 `[图片识别失败：原因]`，对话照常继续（fail-open），错误会写进 DSH 日志。
- **凭证**：复用 `~/.pi/agent/auth.json`（kimi-coding OAuth），pi 会自动刷新 token，无需额外配置。

## 手动测试（不经过 DSH）

```bash
pi -p --no-extensions --no-skills --model kimi-coding/kimi-for-coding \
  --session-dir /tmp/kv-test @图片.png "用中文描述这张图片"
```
