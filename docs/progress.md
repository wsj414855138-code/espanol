# 进度日志

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
