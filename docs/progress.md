# 进度日志

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
