# 调研报告 · 语言学习工具与开源项目（2025-08-14）

> 本报告汇总对市面应用与 GitHub 项目的调研，分四部分：市场应用、GitHub 项目、已吸收 vs 储备、**需要拍板/行动的事项**。
> 产品视角的结论见 `docs/design.md`；学习者视角见 `docs/learner-guide.md`。

---

## 一、市场应用调研（值得借鉴的机制）

| 产品 | 核心机制 | 对我们的启发 | 状态 |
|---|---|---|---|
| [Pimsleur](https://www.techshout.com/best-language-learning-apps/) | 纯听说课程，每 30 分钟只推进约 10 词，全部在"听→复述→对比"循环里 | **能力来自循环而非内容**；内容少而精 | 已吸收：learner-guide 15 分钟四步循环 |
| [Anki](https://wordy.info/blog/anki-for-language-learning-guide) | 间隔重复（SM-2/FSRS），排期算法是灵魂 | 复习排期比学新内容更值钱 | 已吸收：内置 SRS + Anki 导出 |
| Duolingo / Memrise | 游戏化、连胜、每日低门槛 | 习惯设计：固定时间 + 可见进度 | 已吸收：统计条、到期提醒 |
| [Babbel / Busuu](https://www.techshout.com/best-language-learning-apps/) | CEFR 分级课程体系 | 内容难度对齐水平 | 已吸收：meta.level 分级字段 |
| [ELSA Speak / Speechling](https://lingtuitive.com/blog/best-ai-speaking-apps) | 音素级发音评分、真人教练纠音 | 反馈必须具体（哪个音不对） | 已做雏形（Web Speech），升级候选见 §三 |
| LingQ | 带音频的沉浸式阅读 | 素材与音频强绑定 | 储备（后续内容形态） |
| [TalkPal / Langua / Speak](https://lingtuitive.com/blog/best-ai-speaking-apps)、[Babbel AI](https://www.babbel.com/speak-ai-alternatives) | AI 场景化对话陪练 | 结构化练习之后才开放对话 | 储备（对话陪练，见 §三-2） |
| 中文母语专项：[新东方发音自检](https://mtoutiao.xdf.cn/xyz/xibanyayu/xingquxuexi/202604/15174877.html)、沪江 l/r 听辨讨论 | 中文母语者难点清单（清浊/颤音/元音/重音） | 难点可枚举 → 听辨分类设计 | 已吸收：7 类音素听辨 |

## 二、GitHub 项目调研

| 项目 | 是什么 | 借鉴点 | 状态 |
|---|---|---|---|
| [OpenLingo (pretzelai)](https://github.com/pretzelai/openlingo) | 开源 AI 语言学习平台：AI 导师（带工具）+ SRS + 9 类练习 + 阅读翻译；**内容即 Markdown+YAML**，AI 可生成单元 | 与我们的"Markdown 内容 + 零依赖"架构同源；对话陪练、练习类型的实现蓝本 | 储备：AI 对话陪练的参照实现 |
| [the-learning-skill (toddward)](https://github.com/toddward/the-learning-skill) | 通用"学习教练"Agent Skill：目标→输入→诊断→练习→留产物（notes/flashcards/quiz/**anki.tsv**/日程） | "循环式学习会话"设计与 anki.tsv 思路 | 已吸收：export-anki.mjs；learner-guide 结构 |
| [anki-mcp-server](https://www.npmjs.com/package/@ankimcp/anki-mcp-server) | MCP 服务器：AI 通过 MCP 直接读写 Anki | 将来 AI 自动把新词写进她的卡组 | 储备 |
| [SpeechSuper-API-Samples (speechsuper)](https://github.com/speechsuper/SpeechSuper-API-Samples) | 深度学习发音评估 API，8 种语言，中文团队 | 精确发音评分（音素级），中文文档/中文客服 | **储备，需决策**（§三-1） |
| [awesome-language-learning (Vuizur)](https://github.com/Vuizur/awesome-language-learning) | 语言学习资源大全 | 西语播客/听力素材挖掘 | 储备 |
| VocaSpanish (chase-west)、dionisggr/spaced-repetition、Areso/Spanish-exercises、[TfTHacker/spanish-learn-numbers](https://github.com/TfTHacker/spanish-learn-numbers)（Obsidian 插件）、ChaoticaDev/IOSpeech | 各类西语学习小工具 | 小思路参考 | 备查 |

## 三、需要拍板/行动的事项（你的待办清单）

### 1. 发音评分引擎（影响：学习质量上限）
- **现状**：浏览器 Web Speech API（es-ES 转写对比），免费、零依赖；**但 iPhone 的 Safari/Chrome 不支持 SpeechRecognition**——她若主要用手机，评分在她设备上不可用。
- **调研结论（2025-08-14）**：国内大厂（讯飞/腾讯/百度/阿里/火山）发音评测**均未公开支持西语**（讯飞官方文档明确只中英）；**唯一明确支持西语且音素级诊断的是 SpeechSuper（驰声）**，8 语言、官方 Node demo 现成。详细评测见 [docs/speech-eval-research.md](speech-eval-research.md)。
- **决策（用户）**：先用免费 Web Speech 跑通体验 → 升级时申请 SpeechSuper（用户已确认不以省钱为目标，要综合效果性价比）。
- **需要你（1 分钟）**：去 speechsuper.com 填 "Contact us" 表单询价（文案已备好：docs/speechsuper-inquiry.md），拿到 appKey/secretKey 给我。无自助注册渠道（2026-08-16 复查确认）。
- **新方向（2026-08-16，用户提出，先思考后执行）**：录音互动评分与纠偏闭环——不是"给个分"，而是"指出错在哪（音素级）→ 示范 → 重录 → 薄弱音素档案"。完整设计见 docs/design-scoring-feedback.md。

### 2. AI 对话陪练（影响：下一阶段目标）
- 调研结论：**结构化基础巩固之后**才上对话（OpenLingo 的教训：词汇不足时对话退化成查词典）。她目前处于语音/音标阶段，建议先跑 2~4 周 15 分钟循环。
- 启动时可选方案：
  - 自托管 [OpenLingo](https://github.com/pretzelai/openlingo)（开源免费，需 LLM API Key：OpenAI/Anthropic/DeepSeek 等）；
  - 或在我们练习页里加"对话练习"页签（更贴合教材场景，工作量可控）。
- **需要你**：决定启动时机 + 平台偏好；如选 OpenLingo，需要 LLM API Key（用 DeepSeek 的也行）。

### 3. 西语 TTS 音质升级（✅ 已决策并实现：升级 edge-tts）
- **现状 → 升级后**：macOS Mónica → **edge-tts es-ES-ElviraNeural**（微软在线神经语音，女声自然度明显更好）；慢速版用 `--rate=-25%`；mp3 经 macOS `afconvert` 转 m4a 保持旧格式兼容；edge 不可用时自动回退 macOS say（离线兜底）。
- 代价：生成音频需联网（只影响喂料者，不影响学习者练习）。环境：项目 `.venv` 安装 edge-tts（已 gitignore）。
- **需要你**：无（已完成，无需申请任何东西）。

### 4. 真实教材内容（影响：练习与课堂对齐）
- 系统现在是通用 A1 内容。要和她上课同步，需要教材/课件的照片或电子版。
- **需要你/她**：拿到教材后拍照（或给我 PDF），我用 `scripts/ocr.mjs` 提取，整理成学习包。建议拿到**第一课的词汇表和句型**即可开始。

### 5. 需求对齐（小事，但影响体验）
- **主设备**：她主要用 iPhone 还是电脑？（决定 1 的方案 + 录音功能调试优先级）
- **Anki 还是内置 SRS（✅ 已决策 2026-08-16：用内置）**：她主设备 iPhone、零基础非技术用户，Anki 导入/管理对她过重；内置 SRS 已云同步零操作且融入练习页。Anki 导出保留为高级功能不主动推荐，避免双重复习。
- **每日时间**：15 分钟/天是否现实？如果只能 5 分钟，我会把循环压成"复习 + 听辨 3 题"的迷你版。
