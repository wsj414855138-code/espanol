# 产品设计文档 · Learning Spanish

> 状态：v0.1（2025-08-14 起草）。本文档随项目演进，任何重大决策先更新这里。

## 1. 目标与用户

- **学习者**：一位零基础学西班牙语的人（此前学过英语，语言学习基本功扎实），正在北语培训班上课，处于语义/语音/音标起步阶段。
- **喂料者**：不懂西语的项目所有者，负责把教材内容录入系统。
- **AI 协作者**：DeepSeek、Codex 等，按本文档与 ADR 的约定参与内容生产与开发。

**核心目标**：让学习者在培训班之外，每天用 10–30 分钟做"听说"练习，且练习内容与课堂进度对齐，不脱节。

## 2. 设计原则

1. **听说优先**：西语拼写-发音规则性极强（几乎 100% 可预测），练好耳朵和嘴 = 同时解锁听力、拼写、记单词。所有功能围绕"听"与"说"展开。
2. **喂料成本趋近于零**：你不需要懂西语。把教材内容丢成 Markdown，剩下的全自动。
3. **纯文本数据、单向流水线**：`raw(Markdown) → build → packs(JSON) → audio → 练习页`。任何环节可被人或 AI 单步检查。
4. **零依赖优先**：macOS 自带 TTS、Node 标准库、纯前端。不锁死任何云服务；将来要换更强 TTS/评分引擎时，只替换 `generate-audio.mjs` 一个文件。
5. **难度对齐**：内容按课程单元组织（A1 → A2…），先手动标记水平，将来做自动分级。

## 3. 中文母语者的西语难点（功能靶点）

| 难点 | 说明 | 对应功能 |
|---|---|---|
| 清浊对立 b/v, p/b, t/d | 中文无清浊对立，只有送气/不送气 | 听辨：最小对立对（baca/vaca、peso/beso、tía/día） |
| l/r 与 r/rr 颤音 | 肌肉与听辨双重难点 | 听辨 + 跟读录音回放自评 |
| 五个纯元音 | 中文元音带滑音，容易发成双元音 | 听辨（mesa/misa、palo/pelo）+ 跟读 |
| 重音与重读符号 | papa/papá 语义完全不同 | 听辨"重音"类别 |
| 语速下听不出词边界 | 连读、弱读 | 听写（慢速/常速两档）+ 影子跟读 |

## 4. 功能模块

### 4.1 词汇卡（v0.1 已含）
逐词：西语 → 播放发音 → 点击翻面看中文与例句。纯自评式（先想再看）。

### 4.2 听辨训练（v0.1 已含）
随机播放一对最小对立对中的一个词，选 A 还是 B，即时对错反馈 + 计分。类别即靶点（b/v、p/b、t/d、l/r、r/rr、元音、重音）。

### 4.3 影子跟读（v0.1 已含）
听一句（常速）→ 自己录音 → 回放对比。设备侧 MediaRecorder，不上传，无隐私问题。

### 4.4 听写（v0.1 已含）
听（慢速/常速）→ 打字 → 自动判对（忽略大小写、重音、标点）。

### 4.5 路线图（未做，按优先级）
- [x] **SRS 间隔重复（v0.2 已完成）**：`export-anki.mjs` 一键导出 Anki 卡组（词汇卡 + 句型卡 + 音频），利用 Anki 成熟的 SRS 算法。内置 SRS（localStorage + SM-2）列为后续增强
- [ ] **发音评分**：候选方案 [SpeechSuper-API-Samples](https://github.com/speechsuper/SpeechSuper-API-Samples)（深度学习发音评估，覆盖 8 种语言，中文团队，有西语）；或浏览器 Web Speech API es-ES 转写对比（零成本粗反馈）
- [ ] **同源词桥**：标出与英语同源的词（restaurante→restaurant），白送词汇量
- [x] **课本同步工作流（v0.3 已完成）**：拍照教材 → OCR → 自动整理成 source.md（配合喂料者）。实现：`scripts/ocr.swift`（macOS Vision 框架 VNRecognizeTextRequest，默认 zh-Hans + es-ES 双通道合并——中文注释 + 西语重音兼顾，支持 HEIC）+ `scripts/ocr.mjs`（Node 包装：直接打印 / `--out` 写文本 / `--to-source` 生成 source.md 模板骨架）；OCR 结果需人工校对后再进 `data/raw/`
- [ ] **AI 对话陪练**：参考 [OpenLingo](https://github.com/pretzelai/openlingo)（开源 AI 语言学习平台：AI 导师 + SRS + 9 类练习，内容即 Markdown + YAML，与我们架构同源）与 [anki-mcp-server](https://www.npmjs.com/package/@ankimcp/anki-mcp-server)（MCP 驱动 Anki）的交互设计
- [ ] **学习统计**：每日练习量、正确率趋势（localStorage）

### 4.6 可借鉴的开源参考（GitHub 调研 2025-08-14）
- [the-learning-skill](https://github.com/toddward/the-learning-skill)：通用"学习教练"Agent Skill（SKILL.md 规范），产出 notes/flashcards/quiz/**anki.tsv**/复习日程。我们吸收了它的 anki.tsv 思路（见 export-anki.mjs）
- [OpenLingo](https://github.com/pretzelai/openlingo)：开源 AI 语言学习平台，内容即 Markdown、AI 生成单元、SRS + TTS/STT 练习——长期架构参照
- [anki-mcp-server](https://www.npmjs.com/package/@ankimcp/anki-mcp-server)：让 AI 通过 MCP 直接读写 Anki——将来 AI 可自动把新词塞进她的卡组
- [SpeechSuper-API-Samples](https://github.com/speechsuper/SpeechSuper-API-Samples)：发音评估 API 示例（多语言）——发音评分模块的候选引擎
- [VocaSpanish](https://github.com/chase-west/VocaSpanish)：Python TTS + 语音识别背单词——小工具思路参考
- [awesome-language-learning](https://github.com/Vuizur/awesome-language-learning)：语言学习资源清单，可挖西语播客/听力素材

## 5. 数据模型

```jsonc
// data/packs/<课程>/pack.json（由 build-pack.mjs 生成，勿手改）
{
  "id": "a1-leccion-1",
  "title": "A1 第 1 课：问候与自我介绍",
  "meta": { "level": "A1", "source": "通用 A1 示例，待替换为教材内容" },
  "vocab": [
    {
      "id": "v1", "es": "hola", "zh": "你好",
      "example": { "es": "¡Hola! ¿Cómo estás?", "zh": "你好！你好吗？" },
      "audio": "audio/v1.m4a", "exampleAudio": "audio/v1-ex.m4a"
    }
  ],
  "listening": [
    { "id": "l1", "category": "b/v", "pair": ["baca", "vaca"], "zh": "车顶架 / 奶牛",
      "audio": ["audio/l1-0.m4a", "audio/l1-1.m4a"] }
  ],
  "sentences": [
    { "id": "s1", "es": "Me llamo María.", "zh": "我叫玛丽亚。",
      "audio": "audio/s1.m4a", "audioSlow": "audio/s1-slow.m4a" }
  ]
}
```

## 6. 音频策略

- **当前（v0.4）**：edge-tts（微软在线神经语音，`es-ES-ElviraNeural` 女声）优先，mp3 → macOS `afconvert` 转 m4a/AAC 保持格式兼容；慢速档 `--rate=-25%`；**edge 不可用时自动回退 macOS `say`（Mónica，离线兜底）**。联网仅喂料生成时需要，学习者播放无感。
- **将来**：如需更自然的音色或在线部署，只替换 `generate-audio.mjs` 一个文件，pack 结构不感知引擎差异。

## 7. 使用流程（每周）

1. 喂料者：拿到本周课件 → 整理成 `data/raw/<课程>/source.md`（不会西语也没关系，把教材词表/句子誊成表格即可，或直接拍照丢给 AI 整理）。
2. `node scripts/build-pack.mjs <课程> && node scripts/generate-audio.mjs <课程>`
3. 学习者：打开练习页，选课程，每天 10–30 分钟四件套。
