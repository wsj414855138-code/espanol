# 进度日志

## 2026-08-15 · Kimi 视觉桥 v1.2：模型选型基准 + 全面绕开 pi

- **用户要求**：选个快且便宜的模型；pi 慢就绕开它直接调 API；未来可能换千问/豆包等模型。
- **四模型基准**（直连 HTTP + thinking off，d-shadow.png 双轮）：k3 **10.0/10.3s**（最快）；K2.7 13.5/14.7s；highspeed 13.4/13.6s（价 2x）；k3-256k 13.4/13.2s（订阅免费）。质量全部正确转写。
- **定版**：默认模型 → `kimi-coding/k3`（快 ~25%，单图成本 ¥0.1 vs K2.7 ¥0.03，量小无所谓；用户优先速度）。
- **绕开 pi**：识图 100% 直连 `api.kimi.com/coding/v1/chat/completions`（OpenAI 兼容，`data:` base64 图片 + `thinking:{type:"disabled"}` + SSE 流式早停）。pi 仅保留两个兜底：token 过期刷新（401 时跑一次 pi 空调用，约每月一次）、HTTP 全失败时回退 pi CLI（`transport: auto`）。
- **可扩展**：新增 `endpoint`/`apiKey` 配置——以后接千问/豆包只需改三行配置（端点 + 模型 id + key），不用改代码。
- **实测**：k3 冷启动 11.6s，缓存 0ms；live 热加载验证 pid=78136，version 1.2.0。

## 2026-08-15 · Kimi 视觉桥 v1.1：提速（直连 API + 关思考模式）

- **用户反馈**：识图 30s 才开始显示 thinking，太慢。
- **测量**（基准数据）：pi 固定开销 2-4s；带图时 K2.7 先输出大段 `reasoning_content` 再出内容（首个内容 token 6.2s）；`thinking:{type:"disabled"}` 后首个内容 token **3.2s**、同图总耗时 3.5s vs 6.2s（快 45%）。
- **改动（v1.1.0，?r=6，pid=78136 验证已热加载）**：
  1. **直连 HTTP**：POST `https://api.kimi.com/coding/v1/chat/completions`（OpenAI 兼容），Bearer 用 `~/.pi/agent/auth.json` 的 kimi-coding OAuth token；省掉 pi 子进程启动 2-4s；401 时用 pi 跑一次空调用刷新 token 再重试；`transport: auto` 失败自动回退 pi CLI（老路径保留）。
  2. **关思考**：`thinking: {type:"disabled"}`（`disableThinking`，K2.7 不接受时会自动去掉重试）。
  3. **流式早停**：SSE 解析 + `abortAfterChars`（默认 1200）到量即断流，长描述不生成完。
  4. **入队即预热**：监听 `agent/inbox/inserted`，图片一进收件箱就开始识图，与 pre-step/组包并行。
  5. 提示词精简（去掉开场白/总结指令）。
- **实测**：真实截图 cold 12.5s（原 pi 路径 15-25s），缓存命中 0ms。用户端预期 30s → 15~20s（取决于图密度）。
- 踩坑：SSE chunk 在 Node22 fetch 里 `chunk.toString()` 是逗号数字串，必须 `TextDecoder().decode(chunk)`；`enable_thinking:false`/`reasoning_effort:off` 均无效或破坏输出，唯 `thinking:{type:"disabled"}` 有效。

## 2026-08-15 · 视觉桥二次修复：DSH bash 工具 PATH 缺失 node/pi

- **症状复现**：用户再次报告同样的 `bash: node: command not found`；诊断日志为空 → 失败不在插件桥路径。
- **新发现（关键）**：`echo $PATH` 实测 **DSH 的 bash 工具默认 PATH=`/usr/bin:/bin:/usr/sbin:/sbin`，没有 node 也没有 pi**（宿主由 Electron 启动，环境最小化）。所以：
  1. pi 里的 Kimi 调 bash 工具跑 `node` 会失败（r3 已用 --no-tools 封死此路）；
  2. **用户在聊天里让 agent"看这张图"，agent 跑 `node scripts/vision-review.mjs` 也会撞同一个错**——这很可能就是用户看到的"图片解码失败: bash: node: command not found"（模型转述 bash 失败）。
- **修复（r5）**：插件 apply 时把 pi-node bin 目录 prepend 进**宿主进程 `process.env.PATH`**（`extendHostPath`，默认开）。DSH bash 工具子进程 `childEnv = scrubbedParentEnv() + overrides` 继承宿主 PATH → 实测本会话 bash 已能直接 `node --version`（v22.23.2）和 `pi --version`（0.84.1）。
- **验证强化**：status 写入 `pid` + `version`，本次确认 `.status.json` 的 pid=78136 == live 宿主进程（ps 实测），热加载链路首次被铁证确认；新增 `.heartbeat.log`（每次识图 start/ok/fail）与 `.diagnostics.log`（失败详情），下次失败可精确定位。
- 教训：DSH bash 工具 PATH 是宿主最小 PATH，任何依赖 node/pi 的 agent bash 操作都会失败；插件补 PATH 是通用解法。

## 2026-08-15 · Kimi 视觉桥修复：`bash: node: command not found`

- **症状（用户实测）**：发图后模型收到 `图片解码失败: bash: node: command not found`。
- **根因**：DSH 宿主由 Electron 启动，PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`；Kimi 在 pi 里会调用 pi 的 bash 工具执行 `node ...` 分析图片，而 pi 给 bash 工具拼的环境（`~/.pi/agent/bin` + 继承 PATH）里找不到 node。
- **修复（三管齐下，热加载已生效，?r=2→?r=3）**：
  1. pi 加 `--no-tools` 运行（config `noTools: true`）——Kimi 不再有 bash 工具，失败从根上不可能发生；
  2. 插件把 node/npm/npx 软链进 `~/.pi/agent/bin`（pi 自己的辅助 bin 目录，config `ensureNodeInPiBin: true`）——pi 派生的任何 bash 都能找到 node（已用 `bash -c "node --version"` + 最小 PATH 验证 exit 0）；
  3. 失败写诊断日志 `~/.dsh/profiles/web/plugins/kimi-vision/.diagnostics.log`。
- **验证**：r3 回归通过（--no-tools 识图正常，20.5s，注入格式正确）；live `.status.json` = applied: true；软链已就位。

## 2026-08-15 · DSH 插件：Kimi 视觉桥（dsh-plugin-kimi-vision）

- **问题**：主模型是 DeepSeek（纯文本），用户在 DSH 聊天里发图片会被 `session.prompt` 直接拒绝（"当前模型不支持图片"），只能手动把图片丢给 Kimi 再粘贴描述回来，很麻烦。
- **方案（用户确认）**：DSH 宿主侧插件，发图后**自动**调 Kimi 视觉（pi CLI + ~/.pi OAuth，K2.7）把图片描述成文字注入模型请求；原图仍在聊天里显示；DeepSeek 正常回答。
- **实现**：`~/.dsh/profiles/web/plugins/kimi-vision/`（零 npm 依赖）+ `cordis.patch.yml` 注册（热加载，无需重启）。仓库镜像在 `docs/plugins/kimi-vision/`。
  - 补丁 `ctx.llm.resolveModelInfo`：纯文本模型上报 `inputModalities` 含 image，绕开图片准入拒绝；
  - 监听 `llm/stream` waterfall：目标模型纯文本时，图片块 → `[📷 文件名 · Kimi 视觉识别] 描述` 文本块（只改 wire 请求，不动会话日志）；原生看图模型（kimi-coding/k3）原样透传；
  - 描述按附件 id 缓存（内存 + cache.json 落盘），同图秒回；识别失败 fail-open 不中断对话。
- **验证**：独立导入 + 模拟 ctx 端到端冒烟（真实 pi 识图 15~20s，图片从未到达 adapter；二次调用 0ms 缓存命中）；live 热加载后 `.status.json` = `applied: true`；`dsh --profile web --dump-config` 确认条目在树中。
- **踩坑**：cordis 服务访问必须 `inject`（"cannot get property llm without inject"）；插件模块被 import 缓存，改代码后要 bump `name` 里的 `?r=` 查询串才会重载。
- 教训：DSH 图片准入在 `session.prompt`（宿主侧无钩子），唯一干净的绕法是补丁模型能力上报 + 在 wire 层改写请求。

## 2025-08-14 · 校验流程插件化（verify_practice）

- 用户反馈"仍听不到"：服务端与前端链路验证全部正常（7 播放点 play() 成功 + 全 200），判定为**客户端缓存旧 app.js**（旧版播放路径 404）。对策：serve.mjs 缓存策略 `no-cache → no-store` 并重启服务，客户端刷新即拿新文件。
- **校验插件化（用户要求）**：
  - `scripts/verify-audio.mjs`（零依赖静态校验：引用完整/文件存在/非 0 字节/HTTP 抽查）；
  - `scripts/verify-playback.mjs`（puppeteer 真实播放：点击每个播放点 → 请求 200 + `play()` resolve；Chrome 临时目录改用项目内 `.chrome-tmp` 解决插件 shell 环境不可写问题；启动失败自动重试）；
  - **DSH 插件 `verf-6` 注册 `verify_practice` 工具**：一键跑静态 + 播放双层校验，改过音频/播放逻辑后必须运行。实测全绿。
- 教训：播放链路必须做"点击→200→play()"三层验证，不能只看文件存在。

## 2025-08-14 · 修复：播放无声（音频 404）

- **根因（用户实测发现）**：pack.json 的音频是包内相对路径（`audio/xxx.m4a`），前端直接用相对路径播放，页面在 `/app/` 下解析成 `/app/audio/xxx.m4a` → **404**。正确位置是 `/data/packs/<课程>/audio/`。此 bug 自 v0.1 潜伏——此前只验证了静态文件可访问，未真实验证播放链路。
- **修复**：`app.js` 的 `playAudio()` 统一解析：`audio/` 开头的路径自动拼接 `${BASE}/${state.pack.id}/`，一处改动覆盖词汇卡/听辨/跟读/听写全部播放点。
- **验证**：puppeteer 端到端点击五个播放点（单词/例句/听辨/常速/慢速），音频请求全部 200；474 个音频文件本体完好（无 0 字节、AAC 可解码）。

## 2025-08-14 · v0.4.3：方法论与技术选型背书文档

- [docs/evidence.md](evidence.md)：教学方式（SRS/影子跟读/HVPT 听辨/听写/输出假设/同源词/高频循环）逐项列出外部证据并分级（🟢元分析 🟡研究 🔵产品实践 ⚪本组合假设）；技术选型逐项给出对比与理由。
- 关键诚实声明：**"15 分钟四步组合"无直接 RCT**，证据来自组件独立研究 + 产品对标；效果由 learner-guide 毕业标准度量，用数据说话。

## 2025-08-14 · v0.4.2：视觉复核能力固化（Kimi K2.7）

- **视觉方案定版（用户定）**：优先 Kimi **K2.7**（`kimi-coding/kimi-for-coding`，本机 pi 可用模型中无 K2.6，K2.7 为最高可用）。
- **三层可复用形态**：
  1. **DSH 动态插件 `visi-5`（视觉复核工具）**：注册 `vision_review` 模型工具（参数 images/question/model，output schema 校验，180s 超时），会话内可直接调用看图——UI 走查/截图复核不再依赖 bash 拼命令；
  2. **项目脚本 `scripts/vision-review.mjs`**：pi 封装，任何 AI（Codex 也可）和人都能用同一命令看图；
  3. 原 vision 技能保留，默认模型改为 K2.7。
- 实测：K2.7 识别截图内西语单词、按钮、布局问题均准确。
- 插件开发踩坑记录：value schema DSL 要求 output 根显式 `additionalProperties`、参数根必须开放（省略）、不支持 `required`。

## 2025-08-14 · v0.4.1：同源词桥（DeepSeek API）+ API Key 清单

- **同源词桥落地**：`scripts/annotate-cognates.mjs` 用 DeepSeek Chat API 批量标注全部 5 包词汇的英语同源词（58 词命中 40 个，如 agua→water、café→café、color→color；无同源的正确拒绝，如 pan→null、leche→null）；词汇卡翻面显示 "💡 英语同源：xxx"。Key 自动发现：env → 项目 .env → ~/.pi/agent/auth.json，**不落 git**。
- **API Key 策略（用户定）**：能用 DeepSeek key 的先用；待申请项（SpeechSuper 发音评测等）列入 [docs/api-keys.md](api-keys.md)，统一后办。
- 练习页已用系统浏览器打开预览。

## 2025-08-14 · v0.4：TTS 升级 edge-tts + 发音评测调研

- **TTS 升级（用户拍板）**：edge-tts `es-ES-ElviraNeural`（微软在线神经语音）→ `generate-audio.mjs` 支持 `--engine auto|edge|say`，mp3 经 afconvert 转 m4a 保持格式兼容，慢速 -25%，edge 失败自动回退 macOS Mónica；项目 `.venv` 装 edge-tts（已 gitignore）。全量音频重生成中。
- **发音评测调研（用户要求：国内厂商，综合效果与性价比）**：结论——讯飞官方文档明确只支持中英；腾讯/百度/阿里/火山未见西语发音评测；**SpeechSuper（驰声）是唯一明确支持西语（8 语言）且带音素级错误诊断的候选**。详细报告：[docs/speech-eval-research.md](speech-eval-research.md)。决策：先 Web Speech 免费跑通 → 升级时用户申请 SpeechSuper appKey。
- **学习者指南**：[docs/learner-guide.md](learner-guide.md) —— 15 分钟四步基础巩固循环（SRS 复习 → 单类音素听辨 → 跟读评分 → 听写），三条纪律 + 毕业标准。
- 需求对齐（用户回答）：AI 对话陪练**延迟启动**，先巩固基础；主设备手机+电脑（评分方案按 SpeechSuper 规划）；Anki 与内置 SRS 二选一（待她定）。

## 2025-08-14 · v0.3 完成 ✅（三线并行：内容 / OCR / 前端 + 控制台插件）

- **内容扩充（4 个新 A1 学习包）**：数字与电话、颜色、家庭成员、食物饮料——每包 12 词汇 + 7~8 听辨对 + 8 句型，听辨对全部为真实西语词且每对含本课主题词；全库共 5 包 58 词汇 / 45 听辨对 / 40 句型，音频 222 个新生成。
- **课本同步工作流**：`scripts/ocr.swift`（macOS 自带 Vision OCR，**zh-Hans + es-ES 双通道合并**——中文注释与西语重音兼顾，支持 HEIC）+ `scripts/ocr.mjs`（打印 / `--out` / `--to-source` 生成 source.md 骨架）。已实测中西文混合图片识别正确。零 npm 依赖。
- **前端三功能**：
  1. **内置 SRS 复习**：词汇卡"复习模式"开关，简化 SM-2（首答 1 天、成功翻倍封顶 30 天、失败重置），localStorage（`ls_srs_v1`）排期，到期才显示，记得/忘了双按钮；
  2. **学习统计**：今日统计条（`ls_stats`）——听辨对错、听写句数、复习卡数，跨天自动重置；
  3. **发音评分**：跟读录音后 🎯 评分（Web Speech API es-ES 转写 → 逐词命中率 → 三档反馈），不支持时优雅降级。全链路 try/catch，隐私模式可用。
- **DSH 控制台插件（lscn-1）**：会话标题栏 🇪🇸 按钮 + 浮层面板——查看学习包状态、一键构建/音频/Anki、打开练习页（自动拉起服务）。
- 验证：5 包构建 + 音频生成通过；`node --check` 全过；puppeteer 390/1280px 实测 SRS 开关切换、评分按钮、题号徽章、统计条均正常；Kimi 视觉复核通过（复习开关换行微调已修）。

## 2025-08-14（续）· UI 修复 + Anki 导出 + GitHub 调研

- 截图走查：无头 Chrome 在 Retina 屏上视口异常（窗口尺寸不生效），导致两轮"裁切"误报；改用 puppeteer-core + 系统 Chrome 精确 390px/1280px 视口重截，**布局测量确认无溢出**（390px 下 scrollW=390，按钮右缘 376）。Kimi 视觉复核通过。相关 CSS 微调（按钮字号/内边距、播放按钮改胶囊、提示文字换行、听写题号）已保留；页签 hash 深链接（`#vocab` 等）一并支持。
- 截图存档于 docs/screenshots/（手机 + 桌面 × 4 页签）；puppeteer-core 截图脚本留作将来回归测试工具（临时在 /tmp/pu，未入仓库）。
- 新增 `export-anki.mjs`：一键导出 Anki 卡组（词汇卡/句型卡 TSV + 46 个音频），导入步骤写入 README。SRS 间隔重复即刻可用。
- GitHub 调研：吸收 the-learning-skill 的 anki.tsv 思路；登记 OpenLingo（AI 语言学习平台）、anki-mcp-server（AI↔Anki）、SpeechSuper（发音评估 API）、awesome-language-learning 为后续参考（见 design.md §4.6）。
- 截图存档于 docs/screenshots/（手机 + 桌面 × 4 页签）。

## 2025-08-14 · 项目启动与 MVP 完成 ✅

- 完成需求讨论：确认方向 = 内容流水线 + 练习页 Web 应用；原料以培训班教材为主；手机/电脑自适应。
- 环境确认：macOS 自带西语语音（Mónica es_ES / Paulina es_MX），Node v22 可用 → 零依赖方案成立。
- 落盘：README、产品设计文档、ADR-0001、本日志；建立 raw → pack → audio → 练习页 的单向流水线。
- 脚本：`build-pack.mjs`（原料 Markdown → pack.json，表头/分隔行自动过滤，支持 meta 行）、`generate-audio.mjs`（macOS say 生成 m4a，常速/慢速两档，幂等）、`serve.mjs`（静态服务，打印手机访问地址）。
- 练习页：词汇卡（翻面 + 例句发音）、听辨（最小对立对，7 类中文母语难点：b/v、p/b、t/d、l/r、r/rr、元音、重音）、跟读（常速/慢速 + 本地录音回放）、听写（慢速/常速 + 忽略重音标点判对）。
- 示例内容：A1 第 1 课（问候/自我介绍），10 词汇、14 听辨对、8 句型，64 个音频文件（2.4MB）。
- 端到端验证：服务 200、JSON/音频 mime 正确、数据抽查无误。
- git 初始化完成，首个提交已入库。

## 下一步（见 docs/design.md 路线图）

1. 拿到培训班真实教材内容 → 录入为 raw 学习包（可拍照给 AI 整理）。
2. SRS 间隔重复（词汇卡排期 / Anki 导出）。
3. 发音评分（Web Speech API es-ES 粗粒度反馈）。
4. 同源词桥（restaurante→restaurant）。
5. 学习统计（每日练习量、正确率）。

## 2026-08-15 · 无声根因修复（Safari 媒体栈）+ 多模态自动召唤 Kimi 插件

- **根因定位**：serve.mjs 旧版 `res.writeHead(200)` 后 `end(buffer)` → Node 不再补 Content-Length，实际响应为 chunked 无长度、无 Accept-Ranges、无视 Range 请求。Chrome 容忍（puppeteer 验证全过），**Safari/AppleCoreMedia 强制字节区间**：实测其先发 `Range: bytes=0-1` 探测再要全文，旧服务器一律回 200 chunked → 拒播无声。
- **修复**：serve.mjs v2 = 显式 Content-Length + Accept-Ranges + 单区间 Range→206/Content-Range（后缀区间、416 越界）+ 每次请求日志（URL/状态/Range/UA，以后排查直接看日志）。
- **复验**：verify-audio.mjs --http 新增头部断言（Content-Length/Accept-Ranges/206）；AVFoundation（Safari 同引擎）直测服务器 URL：playable=true ✓；verify_practice 全绿；app.js 播放失败不再静默（页面 🔇 toast）。
- **新增 scripts/extract-frames.swift**：零依赖录屏/视频抽帧（AVFoundation），供 Kimi 视觉逐帧分析录屏（两段录屏共 37 帧已分析：用户在词汇例句喇叭/听辨/跟读/听写各点播放，无视觉反馈属设计如此，真因在服务器头部）。
- **新增 DSH 插件 kimi-7/pkg-7（多模态自动召唤 Kimi）**：用户消息含图片 → 自动经 pi CLI（kimi-coding/kimi-for-coding K2.7）逐图分析 → 结果以文字块注入模型上下文；字节安全 base64（DSH btoa 为 UTF-8 语义不可用于二进制）→ `.kimi-tmp/` 中转 → pi；按 attachmentId 去重防重试重复计费；pi 失败兜底绝对路径重试，并注入失败说明。链路已在 bash 实测（base64 与 Buffer 基准逐字节一致、pi 正常出结果）。
- **交接文档**：根目录 `交接文档-音频无声.md`（现象/证据链/修复/复验步骤/接力清单/历史根因备忘）。

## 2026-08-16 · 真实教材入库 + 上线（目标长跑第 1 轮）

- 用户提供 [待归档]真实教材/（BLCU《现代西班牙语》第一册扫描版 + 1-7 课学案 doc/docx + 发音讲义）。
- 学案用 macOS `textutil` 提取（数字文件无需 OCR，准确率 100%），内容质量高（Wynnie 老师学案：问候/人称/SER/国家国籍/数字/职业/物主/ESTAR/HAY/定冠词/房间/颜色/家庭/衣服/TENER/外貌/性格/地点/IR/-AR 变位/动词）。
- 新建 4 个真实学习包：a1-moderno-1（第1课）、a1-moderno-23（第2-3课）、a1-moderno-45（第4-5课）、a1-moderno-67（第6-7课）：每包 12 词汇 + 8 听辨 + 8 句型，音频 224 个（edge-tts/Elvira，慢速版一并生成）。
- 音频生成踩坑：edge-tts 连微软服务深夜超时/被墙 → generate-audio.mjs 新增 `EDGE_TTS_PROXY` 环境变量支持（--proxy），代理重试 3 轮收敛，剩余用 macOS say 兜底补齐；say 兜底跑误改写全 9 包 meta.audio → 已修正统一为 edge-tts/es-ES-ElviraNeural。
- 校验：verify_practice 全绿（9 包静态+HTTP+真实播放 7 播放点）；已推送 GitHub（ea405d2 + e8bd023），Pages 线上 4 新包全 200。
- 待办：扫描版 PDF（《现代西班牙语1》整书）后续可 OCR 补充课文/对话内容；发音讲义 PDF 同理。

## 2026-08-16 · v0.5 数据上云核心完成（目标长跑第 2 轮）

- 新增 app/cloud.js（零依赖纯 fetch）：Supabase 匿名身份（signup + refresh 续期）、SRS 全量拉取合并/推送 upsert、今日统计推送；全部失败静默（离线可练，联网自动补同步）。
- app.js 集成三处（均守卫 typeof CLOUD）：init 后台初始化+拉取合并；saveSRS 后推送；saveStats 后推送。localStorage 仍是唯一事实源，云是备份/跨设备介质。
- 冒烟测试（node 模拟浏览器，真实 Supabase）：匿名注册 ✓、SRS 推送 ✓、跨设备拉取合并 ✓、统计推送 ✓、RLS 拦截匿名查询 ✓。
- 回归：verify_practice 全绿（9 包 + 真实播放）。
- 待办：v0.6 学习报告（读 activity/scores 做热力图与周报）；SpeechSuper 询价等用户提交。

## 2026-08-16 · v0.6 报告页（学习者视角）完成（目标长跑第 3 轮）

- 练习页新增「📊 报告」页签：连续打卡天数（streak 热力图，对标 Duolingo）+ 今日练习次数 + 到期复习卡 + 已学词汇 4 张摘要卡 + 近 8 周打卡热力图（SVG）。
- 数据来源：本地 stats + CLOUD.pullActivity（新增，云端 activity 表近 90 天）；SRS 到期数本地统计。
- 修 bug：loadPack 的 tab 隐藏逻辑未映射 report 页签导致 TypeError → 加 key 守卫。
- 验证：puppeteer 390px 实测渲染正常（无 JS 错误，仅 favicon 404 无害）；Kimi 视觉复核通过；verify_practice 全绿。
- 新增 scripts/pdf2png.swift（PDFKit 逐页转 PNG，供扫描版教材 OCR）。
- 扫描版《现代西班牙语1》（449 页）OCR 试水：正文/目录页 OCR 质量可用，但整书课文 OCR 校对风险高，留待人工校对后入库（学案已覆盖 1-7 课核心）。
- 待办：喂料者周报（需 service_role key，待用户重新生成访问令牌）；SpeechSuper 询价；扫描版课文校对。
