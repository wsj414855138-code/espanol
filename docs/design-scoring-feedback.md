# 设计思考：录音互动评分与纠偏（v0.8 方向，先思考后执行）

> 日期：2026-08-16 · 状态：**规划中，未执行** · 来源：用户提出"对录音、互动内容给出评分反馈，给予纠偏，更好提升"
> 相关调研：[docs/speech-eval-research.md](speech-eval-research.md)、[docs/research.md](research.md)

## 1. 要解决的问题

| 现状 | 问题 |
|---|---|
| 跟读 → 本地录音 → 回放对比 | 只有"回放"，没有"反馈"——她不知道自己读得对不对 |
| 发音评分 = Web Speech es-ES 转写对比 | **iPhone Safari/Chrome 不支持 SpeechRecognition** → 她主设备是 iPhone，手机上评分完全不可用 |
| 听辨题（7 类难点音素） | 训练了"听"的辨别，但"说"的对错没有数据 |

**核心痛点：手机上跟读模块没有闭环——录了音，不知道错在哪、怎么改。**

## 2. 目标体验：纠偏闭环（四个层次）

```
① 评分    跟读 → 录音 → 打分（0-100 + 星级/等级），即时反馈
② 定位    指出错在哪：句子级 → 词级 → 音素级（哪个音素错了）
③ 纠偏    错误类型说明（增音/漏音/替换）+ 重听标准音 + 慢速示范
④ 沉淀    错误进档案（scores 表 phoneme_errors 字段已预留）→ 报告页"薄弱音素 TOP"
           → 自动把薄弱音素对应的听辨题排进复习（与 7 类中文母语难点联动）
```

**差异化亮点**：不是"给个分"，而是**错误音素 → 自动关联我们的听辨难点库 → 针对性再练**——这正好用上项目已有的 7 类难点体系（b/v、p/b、t/d、l/r、r/rr、元音、重音），形成"听辨发现不了的问题，跟读评分发现，再回到听辨解决"的闭环。

## 3. 技术路径对比

| 方案 | 音素级纠偏 | iPhone 可用 | 成本 | 结论 |
|---|---|---|---|---|
| **SpeechSuper（驰声）** | ✅ 增/漏/替换 + 音素/词/句评分 | ✅ Web SDK / 服务端 API | 询价中（按量） | **唯一满足"纠偏"的方案** |
| Whisper 类转写对比 | ⚠️ 只能词级，无音素诊断 | ✅ | 自建 API 成本 + 延迟 | 备选，纠偏能力弱 |
| 本地波形/时长比对 | ❌ 只有粗分数 | ✅ | 免费 | 无纠偏价值，放弃 |

调研结论（speech-eval-research.md）：国内大厂（讯飞/腾讯/百度/阿里/火山）发音评测**均未公开支持西语**；SpeechSuper 是唯一明确支持西语且带**音素级诊断**（insertion/deletion/substitution）的厂商，有官方 Node/Web 示例，中文团队。

## 4. 架构设计（拿到 key 后）

```
iPhone Safari（https，麦克风权限）
   │  getUserMedia 录音 → wav（16kHz / mono / 16bit，官方建议参数）
   ▼
练习页 app.js（跟读模块）
   │  POST wav + 参考文本
   ▼
Supabase Edge Function（代理层，SpeechSuper appKey/secretKey 只存这里，不进网页）
   │  调 SpeechSuper API（HTTP/WebSocket）
   ▼
音素级结果 { sentence/word/phoneme 分 + 错误列表 }
   │
   ├─→ 前端渲染：分数 + 错误标注 + 标准音重放
   └─→ 写入 scores 表（phoneme_errors jsonb）→ 报告页薄弱音素
```

依赖：SpeechSuper appKey/secretKey（用户 1 分钟填表单询价）、Supabase Edge Function 部署（需 CLI/token，已有 service_role 可用）。

## 5. 交互设计要点（手机优先）

1. **跟读流程**：听标准音（常速/慢速）→ 录音 → 自动评分（秒级）
2. **结果呈现**：大字分数 + 一句人话反馈（"很棒！" / "有两个音要纠正"）
3. **纠偏视图**：句子按词着色（红=错、黄=勉强、绿=好）；点红色词 → 显示"你发成了 X，正确的是 Y" + 标准音重播
4. **重录**：一键重录，鼓励"再试一次"（错误率下降就是进步，存进档案）
5. **不挫败原则**：错误提示用"接近了！B 和 V 的区别是嘴唇…"式引导，不用红叉风暴

## 6. 数据与闭环

- scores 表已建好（id/user_id/pack_id/sentence_id/score/phoneme_errors/engine/created_at）——**设计时就预留了**
- 新增字段考虑：`attempts`（重录次数）→ 看"纠偏是否有效"（尝试后分数是否上升）
- 报告页新增"薄弱音素"卡片：按 phoneme_errors 聚合 TOP 5 → 点击跳转对应听辨题
- 与 SRS 联动：发音错误 ≥2 次的卡片，复习时优先出现

## 7. 实施顺序（前置依赖）

1. **[待用户]** SpeechSuper 询价表单提交（1 分钟，文案见 speechsuper-inquiry.md）→ 拿 appKey/secretKey
2. **[我]** Supabase Edge Function 代理 + 录音采集（wav 16k mono）+ 前端评分 UI + scores 写入
3. **[我]** 报告页薄弱音素卡片 + 与听辨难点库联动
4. **[我]** 纠偏有效性统计（attempts 前后分数对比）→ 数据驱动迭代

## 8. 风险与降级

- SpeechSuper 询价无回应/太贵 → 备选：Whisper 词级转写对比（降级为"词级定位"，无音素诊断）
- Edge Function 冷启动延迟 → 评分请求加 loading 态；必要时换常驻 Node 服务（部署在老婆电脑？不——线上需求，用 Supabase 免费额度先验证）
- iPhone 录音格式兼容 → 已按官方建议参数（16kHz/mono/wav），实测验证

## 9. 一句话总结

**"给个分"是起点，"告诉你错在哪、怎么改、再练一遍"才是纠偏闭环**——SpeechSuper 是唯一能支撑这个闭环的引擎；方案已想清楚、表结构已预留，万事俱备只欠 key。
