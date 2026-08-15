# SpeechSuper 询价表单文案（复制粘贴用）

> 打开 https://www.speechsuper.com/ → 点 "Contact us" → 把下面内容粘贴进表单（有必填项如姓名/邮箱/公司就填你自己的：姓名随意，公司填"个人开发者/个人学习应用"）

---

主题：西语发音评测 API（Pronunciation Assessment API）生产环境使用询价

您好：

我们是一个西班牙语学习 Web 应用（面向中文母语学习者，个人学习场景），希望接入贵司的 Pronunciation Assessment API（sentence evaluation，即 `sent.eval.promax`），用于网页端"跟读练习"的发音评分与纠错反馈。

想确认以下几点：

1. **西班牙语引擎状态**：西班牙语（Spanish）评测是否已生产级可用？音素级诊断（增音/漏音/替换，insertion/deletion/substitution）在西班牙语下是否完整支持？
2. **试用额度**：是否有试用/测试额度？如何开通？
3. **计费方式**：按次还是按时长计费？单价是多少？是否有包月/包年方案？
4. **Web 接入**：我们计划在浏览器端录音（Web Audio API 录音，wav 格式，16kHz/mono），直接调用贵司 HTTP/WebSocket 接口——Javascript/Node 示例是否可以直接用于 Web 前端场景？服务端代理调用是否更推荐？

应用规模：单用户低频使用（预估每天几十次评测调用），以效果和性价比为主要考量。

期待您的回复，谢谢！

---

## 背景备忘（为什么选它 + 替换项）

- **为什么 SpeechSuper**：国内大厂（讯飞/腾讯/百度/阿里/火山）发音评测均未公开支持西语；SpeechSuper 是唯一明确支持西语且带音素级诊断的（调研见 docs/speech-eval-research.md）
- **拿到 key 后的接入方案**：appKey/secretKey 放在 Supabase Edge Function 里（服务端代理，密钥不暴露给网页）→ 网页传录音 wav + 参考文本 → Edge Function 调 SpeechSuper → 返回音素级结果
- **音频要求**（官方）：16-bit / 16kHz / 单声道 / ≥96kbps；支持 wav/mp3/opus/ogg/amr
