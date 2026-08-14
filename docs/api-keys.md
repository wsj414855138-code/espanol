# API Key 清单与申请状态

> 原则（用户定）：**能用 DeepSeek 自己的 key 顶着用的先用着**；搞不定的列在这里，统一申请。
> Key 一律不提交 git（环境变量 / 项目 .env 已被 gitignore / 本机凭据文件）。

## ✅ 已在使用（无需申请）

| 用途 | 方案 | Key 来源 |
|---|---|---|
| 同源词桥（v0.4.1） | DeepSeek Chat API（`deepseek-chat`） | `~/.pi/agent/auth.json` → `deepseek.key`（脚本自动发现；也可用 `DEEPSEEK_API_KEY` 环境变量或项目 `.env`） |
| 西语 TTS | edge-tts（微软免费在线语音） | 无需 Key |
| 发音评分（当前） | 浏览器 Web Speech API（es-ES） | 无需 Key |
| OCR | macOS Vision（本地） | 无需 Key |
| 跟读录音 | MediaRecorder（本地） | 无需 Key |

## ⏳ 待统一申请（未阻塞当前阶段）

| 用途 | 方案 | 申请动作 | 优先级 |
|---|---|---|---|
| 精确发音评分（升级项） | SpeechSuper（驰声，唯一明确支持西语、音素级诊断） | speechsuper.com → "Contact us" 填表询价：① 西语引擎是否生产级 ② 有无试用额度 ③ 按量单价；拿到 appKey/secretKey | 中（基础巩固 2~4 周后再申请不迟） |
| AI 对话陪练（下一阶段） | DeepSeek Chat API（已有 key，可先用）；若做 OpenLingo 自托管同理 | 无需新申请，key 已在用 | 低（用户已定延迟启动） |
| （备选）发音评分 | Azure Speech / Speechace | 需要国际账号与支付方式，仅当 SpeechSuper 不满意时考虑 | 低 |

## 用法备忘

- 同源词标注：`node scripts/annotate-cognates.mjs --all [--force]`
- 若将来新增需要 key 的功能，把 key 写入项目 `.env`（`KEY_NAME=xxx`，.gitignore 已含），脚本里 `import 'dotenv'` 不可用时自行读取即可（本项目无依赖，用 fs 读 .env 的写法参考 annotate-cognates.mjs）。
