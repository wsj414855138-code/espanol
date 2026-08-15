# Learning Spanish · 西班牙语陪练

帮一位零基础（但有英语功底）的西班牙语学习者，做一套**跟着培训班进度走的听说陪练工具**。

**核心思路**：你（老公）负责"喂料"——把培训班教材的内容整理成简单的 Markdown 文件；系统负责"烹饪"——自动生成结构化学习包、西语音频、练习页。她打开网页就能练：词汇卡、听辨、跟读、听写。

---

## 快速开始

```bash
# 1. 生成学习包（解析 data/raw/<课程>/source.md → data/packs/<课程>/pack.json）
node scripts/build-pack.mjs a1-leccion-1

# 2. 生成西语音频（macOS 自带语音，无需联网/密钥）
node scripts/generate-audio.mjs a1-leccion-1

# 3.（可选）导出 Anki 卡组：词汇卡 + 句型卡 + 音频（配合 Anki 间隔重复复习）
node scripts/export-anki.mjs a1-leccion-1

# 4. 启动练习页（手机和电脑在同一局域网内即可访问）
node scripts/serve.mjs          # 默认 http://localhost:8000/app/
```

### Anki 导入（3 步，约 2 分钟）

1. Anki 桌面版：工具 → 管理笔记类型 → 添加 → 基础（正反卡片）→ 重命名「西语」，把字段改为：`西语 | 中文 | 例句 | 例句中文 | 音频`
2. 文件 → 导入 → 选 `data/packs/<课程>/anki-vocab.tsv`（字段分隔符选"制表符"，允许 HTML 关）
3. 工具 → 打开媒体文件夹 → 把 `data/packs/<课程>/anki-media/` 里的文件拷进去（卡片的发音就有了）

> 听写卡：再导入一次 `anki-sentences.tsv`（同样 3 步）。Anki 的间隔重复（SRS）算法会安排每天的复习时间。

> 手机访问：在电脑上先 `ipconfig getifaddr en0` 拿到局域网 IP，手机浏览器打开 `http://<IP>:8000/app/`。

## 三个角色怎么用

| 角色 | 做什么 |
|---|---|
| **老婆（学习者）** | 打开练习页 → 选课程 → 练词汇卡 / 听辨 / 跟读 / 听写。**先读 [docs/learner-guide.md](docs/learner-guide.md)：每天 15 分钟"基础巩固循环"，四步固定流程，强调出声练习** |
| **你（喂料者）** | 把教材/课件内容整理成 `data/raw/<课程>/source.md`（格式见下），跑两步命令即可上线；每周配套动作见 learner-guide 第四节 |
| **AI（DeepSeek / Codex）** | 按 `docs/` 里的约定帮忙生成内容、修 bug、加功能 |

## 课本同步工作流（拍照 → OCR → 整理，v0.3 新增）

不懂西语也不怕：给教材页面拍张照，让电脑帮你把文字提取出来，再人工校对整理成 source.md。

```bash
# 1. 拍照：手机拍教材页，AirDrop/微信传到电脑（png/jpg/heic 都行）

# 2. OCR：把照片里的文字识别出来（macOS 自带 Vision 框架，无需联网/装包）
node scripts/ocr.mjs 照片.png --out out.txt --to-source
#   生成：
#     out.txt              ← OCR 识别出的原文（逐行，"行号: 文本"）
#     out.source.md        ← 课程原料模板（三张表表头 + 底部附 OCR 原文，方便边看边整理）

# 3. 整理：打开 out.source.md，把 OCR 原文逐行搬进三张表（西语 + 中文翻译），
#    删掉底部"OCR 原文"小节，改名为 source.md 放进 data/raw/<课程>/
```

> ⚠️ OCR 不是 100% 准确，尤其教材排版复杂（表格、加粗、栏间距）时容易串行或漏字，**必须人工校对**再入库；西语重音符号（é/í/á/ñ/¿¡）也会偶尔识别错，以教材原书为准。
>
> 默认同时识别中文 + 西语（自动双通道合并，中文注释和西语重音都能兼顾）；也可用 `--lang es-ES` 只识别西语。依赖 Xcode Command Line Tools（`xcode-select --install` 可装）。

## 内容原料格式（data/raw/<课程>/source.md）

一个 Markdown 文件，三个小节，全是表格，**任何人（包括 AI）都能写**：

```markdown
# 课程标题

## 词汇
| 西语 | 中文 | 例句（西语） | 例句（中文） |
|---|---|---|---|
| hola | 你好 | ¡Hola! ¿Cómo estás? | 你好！你好吗？ |

## 听辨
| 类别 | 词A | 词B | 中文说明 |
|---|---|---|---|
| b/v | baca | vaca | 车顶架 / 奶牛 |

## 句型
| 西语 | 中文 |
|---|---|
| Me llamo María. | 我叫玛丽亚。 |
```

## 目录结构

```
Learning Espanish/
├── README.md            ← 你在这里
├── docs/
│   ├── design.md        ← 产品设计文档（目标、功能、路线图）
│   ├── adr/             ← 架构决策记录（为什么这么做）
│   ├── progress.md      ← 进度日志
│   └── plugins/kimi-vision/ ← DSH 插件「Kimi 视觉桥」源码镜像 + 文档
├── data/
│   ├── raw/             ← 原料：人工/AI 编辑的 Markdown（唯一"入口"）
│   │   └── <课程>/
│   │       └── source.md
│   └── packs/           ← 产物：结构化 JSON + 音频（由脚本生成，勿手改）
│       ├── index.json
│       └── <课程>/
│           ├── pack.json
│           └── audio/*.m4a
├── scripts/             ← Node 脚本（零依赖，node >= 18）
│   ├── build-pack.mjs   ← 原料 → pack.json
│   ├── generate-audio.mjs ← pack.json → 音频（edge-tts 优先 / macOS say 兜底）
│   ├── export-anki.mjs  ← pack → Anki 卡组 TSV + 音频（间隔重复复习）
│   ├── annotate-cognates.mjs ← DeepSeek API 标注英语同源词（同源词桥）
│   ├── vision-review.mjs ← Kimi K2.7 视觉复核（看图回答，UI 走查/截图复核用）
│   ├── ocr.mjs          ← 教材拍照 OCR 的 Node 包装（打印 / 写文件 / 生成 source.md 模板）
│   ├── ocr.swift        ← OCR 本体：macOS Vision 框架，默认 zh-Hans + es-ES 双通道合并
│   └── serve.mjs        ← 静态练习页服务器
└── app/                 ← 练习页（纯 HTML/CSS/JS，无构建步骤）
    ├── index.html
    ├── app.css
    └── app.js
```

## 给 Codex / AI 协作者的约定

1. **数据只在 `data/raw/` 里手写**，`data/packs/` 是产物，靠脚本生成，别手改。
2. **技术栈**：Node 脚本（零 npm 依赖）+ 纯前端（无框架、无构建步骤）。别引入需要 `npm install` 的依赖，除非在 ADR 里先记录理由。
3. **改动先读 `docs/`**：设计决策记在 `docs/adr/`，进度记在 `docs/progress.md`，动手前先看。
4. **提交粒度小**：一次提交一件事，消息用中文或英文都行，但要说清楚"为什么"。
5. 新增功能请保持"原料 → 构建 → 练习页"这条单向流水线不破坏。

## 部署到 GitHub Pages（老婆任何网络可用）

1. 首次：注册 GitHub → 本机 `gh auth login` 授权（或 Codex/DeepSeek 代跑）。
2. 一键部署：`bash scripts/deploy-pages.sh`（自动自检内容 → 提交 → 推送 → Pages 自动发布）。
3. 线上地址：`https://<用户名>.github.io/<仓库名>/app/`（本仓库 = https://wsj414855138-code.github.io/espanol/app/）。
4. iPhone：Safari 打开 → 分享 → "添加到主屏幕"，全屏像 App 一样用。
5. 更新内容：改 `data/raw/` → 跑构建脚本 → `bash scripts/deploy-pages.sh` → 1-2 分钟后老婆刷新即得新版。

> 注意：GitHub Pages 免费版要求仓库公开；国内访问 github.io 一般可用，若某天变慢可换 Cloudflare Pages（内容不用动）。
