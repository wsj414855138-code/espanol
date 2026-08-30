# 更新记录 CHANGELOG

> 格式：版本 · 日期 · 主要内容。详细开发过程见 [docs/progress.md](docs/progress.md)。

## v0.7.1 · 2026-08-29 · 内容更新：第 8-9 课 + 旧版 9-10 补充 + Repaso 复习课

- **新增 3 个学习包**（docx 课件 → source.md → 音频全流水线）：
  - a1-moderno-89（第 8-9 课：能愿动词与宾格代词，32 词/9 听辨/21 句型）——poder/ver/querer/venir/decir、hay que/tener que、宾格代词、重读物主形容词、水果电影词汇、姓名问答；听辨新增词干元音变化对（puedo/puede 等）。
  - a1-moderno-910（第 9-10 课补充：与格代词与交通工具，17 词/8 听辨/16 句型）——交通工具与场所、与格代词 le/les、volver/saber、¿Qué/Dónde/Cómo 问答。
  - a1-repaso-colores-familia（复习课：颜色与家庭，20 词/7 听辨/13 句型）——颜色性数一致、家庭成员、问答复习；听辨以阴阳性别对为主。
- **排序调整**：5 个通用示例包 order 12-16 后移至 15-19，现西课程序列 0-14 保持连续。
- 排除项：源 docx 变位填空表（无答案）与《Bailando》歌词未入库。
- 20 个学习包 / 1570 段音频；三层校验通过（文件 / HTTP 媒体头 / Chrome 播放冒烟）。

## v0.7 · 2026-08-16 · PWA + 课程排序 + 发音基础

- **PWA 化**：manifest + 应用图标（Swift 生成）+ Service Worker 离线缓存（应用外壳 + 数据清单，音频在线播放）；iPhone 添加到主屏幕后全屏使用。
- **课程排序**：学习包按课本顺序排列（`meta.order`：发音基础 → 第 1-7 课学案+课文）；修 build-pack 两个解析 bug。
- **新增发音基础包**：按《西班牙语发音讲义》制作（b/v、p、g、d、r/rr、ll、ch 代表词 + 对立听辨）。
- **真实教材全入库**：《现代西班牙语》第一册 1-7 课学案 + 课文（OCR + 人工校对）全部上线。
- 17 个学习包 / 952 段音频；全量三层校验通过。

## v0.6 · 2026-08-16 · 学习报告

- 练习页新增「📊 报告」页签：连续打卡天数、今日练习量、到期复习卡、已学词汇、近 8 周打卡热力图（SVG，对标 Duolingo streak 日历）。
- 数据来自云端 activity 表（`cloud.js` 新增 `pullActivity`）+ 本地统计合并。

## v0.5 · 2026-08-16 · 学习记录上云

- 新增 `app/cloud.js`（零依赖，纯 fetch）：Supabase **匿名身份**（免注册登录）+ SRS 间隔重复记录与每日统计**自动云同步**。
- 离线兜底：断网本地照常练习，联网后自动合并；换设备/清缓存进度不丢。
- 数据库：Supabase 项目（新加坡）三张表 `srs` / `activity` / `scores` + RLS 行级安全（每人只能读写自己的数据）。

## v0.4.x · 2026-08-14 ~ 15 · 音质 / 同源词 / 视觉 / 证据

- **v0.4.3** 证据文档：docs/evidence.md（教学依据分级引用 🟢🟡🔵⚪，诚实标注"组合式 15 分钟循环无直接 RCT"）。
- **v0.4.2** 视觉能力：Kimi K2.7（kimi-coding/kimi-for-coding）接入——UI 走查 / 录屏帧分析 / 图片识别（DSH 插件 + 项目脚本双通道）。
- **v0.4.1** 同源词桥：DeepSeek 批量标注英语同源词（restaurante→restaurant），卡片翻面显示 💡 提示；API 密钥治理文档。
- **v0.4** TTS 升级：edge-tts（微软神经语音 es-ES-ElviraNeural）替代 macOS 系统音，自然度明显提升；慢速版 `--rate=-25%`；mp3→m4a 转码保持兼容；edge 不可用时自动回退 `say`。
- 同批：修复 Safari 无声根因（服务器媒体头：Content-Length + Accept-Ranges + Range/206，见 [交接文档-音频无声.md](交接文档-音频无声.md)）；校验流程插件化（verify_practice：静态 + 真实播放双层）。

## v0.3 · 2026-08-14 · 课本同步工作流

- macOS Vision 双通道 OCR（zh-Hans + es-ES）：教材拍照 → 文字 → source.md 模板骨架（`scripts/ocr.swift` + `ocr.mjs`）。
- 内容扩至 5 个通用学习包；SRS 复习模式（记得/忘了）UI；发音评分（Web Speech es-ES 三档反馈）；学习统计（今日听辨/听写/复习）。

## v0.2 · 2026-08-14 · Anki 导出 + UI 完善

- Anki 卡组一键导出（词汇卡 + 句型卡 + 音频媒体，`export-anki.mjs`）：利用 Anki 成熟的 SRS 算法。
- UI 修复：按钮内边距、播放按钮胶囊样式、提示换行、听写题号；页签 hash 深链接。

## v0.1 · 2026-08-14 · MVP

- 项目启动：需求确认（听说优先 + 内容流水线 + 练习页 Web 应用，手机/电脑自适应）。
- 单向流水线：`data/raw/<课程>/source.md` → `build-pack.mjs` → pack.json → `generate-audio.mjs`（macOS say）→ m4a → 静态练习页。
- 练习页四模块：词汇卡（翻面+例句发音）、听辨（7 类中文母语难点最小对立对）、跟读（常速/慢速+录音回放）、听写（自动判对，忽略重音标点）。
- 零依赖原则确立：Node 标准库 + 原生前端，任何环境可跑。
