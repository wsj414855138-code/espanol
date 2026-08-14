# 方法论与技术选型背书（外部证据）

> 2025-08-14 · 用途：回答"凭什么这样做"——每条设计都有外部证据支撑，并标注**证据等级**：
> - **🟢 强**：元分析 / 系统综述 / 大规模对照研究
> - **🟡 中**：有同行评审研究支持，样本或场景有限
> - **🔵 产品实践**：成熟产品长期商业验证（非学术证据）
> - **⚪ 本组合假设**：本项目"15 分钟四步组合"本身**没有直接实验**，依据是各组件的独立证据 + 产品对标，效果需家庭场景迭代验证（learner-guide 中有可度量的毕业标准）

---

## 一、教学方式的背书（为什么这样练）

| # | 我们采用的方式 | 原理 | 外部证据 | 等级 |
|---|---|---|---|---|
| 1 | **间隔重复（SRS 复习）** | 遗忘曲线 + 分布练习：把复习分散到递增间隔，长期保持显著优于集中复习 | [Cepeda et al. 2006《Distributed Practice in Verbal Recall Tasks》Psychological Bulletin 元分析](https://psycnet.apa.org/doiLanding?doi=10.1037%2F0033-2909.132.3.354)（Ebbinghaus 1885 遗忘曲线为源头） | 🟢 |
| 2 | **影子跟读（听→复述→对比）** | 同步模仿母语者语音，强化韵律与发音肌肉记忆 | [2025 年《A Systematic Review of Research on the use of Shadowing for Second Language Pronunciation Teaching》（Taylor & Francis 系统综述）](https://www.tandfonline.com/doi/full/10.1080/29984475.2025.2546827) | 🟢 |
| 3 | **最小对立对听辨（b/v、l/r…）** | 高变异性知觉训练（HVPT）：多词对、逐对对比能重塑成人对非母语音位的知觉，且**知觉训练可迁移到发音产出** | [Applied Psycholinguistics《Comparing lower and higher variability multi-talker perceptual training》](https://www.cambridge.org/core/journals/applied-psycholinguistics/article/comparing-lower-and-higher-variability-multitalker-perceptual-training/2755FEDEFB74EC4A3DD83011015BCB97)；母语音系干扰二语知觉：[《Allophonic and phonemic tap dance…》](https://www.cambridge.org/core/journals/applied-psycholinguistics/article/allophonic-and-phonemic-tap-dance-the-influence-of-native-phonology-on-nonnative-phonetic-perception-and-lexical-encoding/901CB290B7061D85F234A28FBFCA37F1) | 🟢/🟡 |
| 4 | **中文母语难点分类（r 颤音/清浊/元音/重音）** | 靶点来自中文母语者西语语音习得的实际研究 | [程熙《中国学生西班牙语 r 音习得研究》（万方/CNKI 学位论文）](https://cdmd.cnki.com.cn/Article/CDMD-10271-1018231471.htm) | 🟡 |
| 5 | **听写（听→写→核对）** | 输出迫使"精确加工"：检验听力切分，促进形式-意义联结 | Dictogloss 源头 [Swain 1985](https://www.mdpi.com/2227-7102/15/5/618)；大学英语听写实证（CNKI 硕士论文） | 🟡 |
| 6 | **出声输出 > 默读（跟读必须录音）** | 可理解输出假设：产出促使学习者注意语言形式缺口 | [Swain, M. (1985). Communicative competence: Some roles of comprehensible input and comprehensible output in its development](https://www.sciencedirect.com/science/article/pii/S0911604426000308)（output hypothesis 经典文献，经检索确认其持续引用） | 🟡 |
| 7 | **少量高频词循环（每周 ≤1 课）** | 频率效应：高频词是 A1 交际的绝大多数；刻意练习强调重复与反馈 | [Ericsson, Krampe & Tesch-Römer (1993) deliberate practice](https://psycnet.apa.org/record/1993-40786-001)（刻意练习框架）；频率效应综述（Ellis 2002） | 🟡 |
| 8 | **同源词桥（英语→西语白送词汇）** | 同源词促进效应：跨语言形-音重叠加速二语词汇识别 | [《Cross-linguistic effects of form overlap in aural recognition of Spanish–English cognates》Bilingualism: Language and Cognition](https://www.cambridge.org/core/journals/bilingualism-language-and-cognition/article/crosslinguistic-effects-of-form-overlap-in-aural-recognition-of-spanishenglish-cognates/7152726A8F9A61CCFC55F2E68A59D1BB) | 🟡 |

## 二、理念可对标的结局结果（这套理念在别处得到过什么）

| 对标对象 | 结果 | 证据 | 等级 |
|---|---|---|---|
| **分布练习（=SRS 的学术基础）** | 元分析确认：间隔复习在长期保持上系统性优于集中复习（效应量显著） | [Cepeda et al. 2006](https://psycnet.apa.org/doiLanding?doi=10.1037%2F0033-2909.132.3.354) | 🟢 |
| **Pimsleur** | 1967 年提出 graduated interval recall（间隔复习的早期工程化），60 年商业化验证"听说循环"教学 | Pimsleur (1967) 及方法论文献 | 🔵 |
| **Anki / SM-2** | 全球最广泛使用的语言学习记忆软件（社区规模千万级），算法与我们的 SRS 同源 | [Anki 官方](https://apps.ankiweb.net/)、SM-2 算法（SuperMemo 1987） | 🔵 |
| **Duolingo（游戏化+碎片+低门槛）** | 对照研究：34 小时 Duolingo ≈ 美国大学一学期入门课（西班牙语） | [Vesselinov & Grego (2012) Duolingo Effectiveness Study](http://static.duolingo.com/s3/DuolingoReport_Final.pdf)；更严格设计的德语对照研究：[SIU《Comparing the Effectiveness of One Semester of German Study》](https://opensiuc.lib.siu.edu/theses/2847/) | 🟡 |
| **知觉训练 → 发音产出** | 成人（非儿童）也能通过知觉训练学会新音位，且听力进步会带动口语 | HVPT 文献（[Applied Psycholinguistics 2025](https://www.cambridge.org/core/journals/applied-psycholinguistics/article/comparing-lower-and-higher-variability-multitalker-perceptual-training/2755FEDEFB74EC4A3DD83011015BCB97) 及 Lively et al. 1993 经典序列） | 🟡 |
| **发音即时反馈（ELSA Speak 等）** | "练习+音素级反馈"被商业与教育市场反复验证为发音训练核心 | ELSA 学术合作文献（其效果研究发表于 ICASSP/教育期刊） | 🔵 |

## 三、技术选型为什么好（逐项对比）

| 技术 | 选择理由 | 对比对象 | 代价/局限（诚实标注） |
|---|---|---|---|
| **edge-tts（微软神经语音）** | 底层与 Azure Neural TTS 同源引擎，官方宣称自然度接近真人（MOS 4.7 级）；**免费、无需注册**；[合成语音评价综述](https://www.semanticscholar.org/paper/A-review-on-subjective-and-objective-evaluation-of-Cooper-Huang/24a9acb3b4da4463eabf887a04d96911b8bcd9c7)确认 MOS 为行业标准 | macOS say（旧式合成、机械感）、ElevenLabs（付费、需国际支付）、Azure（需 key） | 生成需联网；非开源 |
| **SpeechSuper 发音评测（升级候选）** | **唯一明确支持西语的音素级评测**（官方 8 语言清单含 Spanish）；音素级错误诊断（增/漏/替换）正中"哪个音不对"原则；中文团队沟通无障碍 | 讯飞（[官方文档明确只支持中英](https://shandong.xfyun.cn/doc/Ise/IseAPI.html)）、腾讯/百度（未公开西语） | 商务询价制、价格未公开 |
| **Web Speech API（当前评分）** | 免费、零依赖、浏览器本地处理；es-ES 识别即用 | — | **iPhone 不支持、粗粒度**——明确为过渡方案 |
| **macOS Vision OCR** | 本地处理不上传教材（隐私）、免费；双通道方案（zh-Hans+es-ES 合并）解决"顾此失彼"实测问题 | 云 OCR（按量付费 + 教材照片上传） | 仅 macOS 可用；需人工校对 |
| **DeepSeek API（同源词标注）** | 性价比（官方定价显著低于 OpenAI 同级）；中文生态；同源词任务简单，deepseek-chat 足够 | OpenAI（贵）、本地模型（部署成本） | 依赖联网；key 管理需谨慎（已 gitignore） |
| **简化 SM-2（内置 SRS）** | 源自被 Anki 验证的算法；零依赖自研、数据在 localStorage（隐私） | FSRS（更先进但需导入算法库，破坏零依赖原则） | 间隔上限 30 天的简化版，不如 FSRS 自适应 |
| **Kimi K2.7 视觉（vision_review）** | 多模态理解（读图/走查 UI），与 pi 凭据生态零配置集成；视觉复核闭环替代"人盯截图" | 其他视觉模型（需另配 key） | 依赖 pi CLI 环境 |
| **零依赖 Node 标准库 + 纯前端** | 可审计、可复制、无供应链风险；Codex/DeepSeek 都能零环境接手 | npm 生态（依赖膨胀） | 功能迭代速度略慢（自研为主） |

---

## 四、一句话结论（克制版）

**我们的每一种练习方式，都有对应领域的学术证据或成熟产品验证；但"15 分钟四步组合"本身没有直接实验背书**——它是对 Pimsleur（循环）、Anki（排期）、HVPT（听辨）、Swain（输出）等已验证组件的工程化组合。真实效果将由 learner-guide 的毕业标准（七类音素连续两天全对、评分 ≥80%、SRS 间隔 ≥7 天）在家庭场景中度量，届时用数据说话，而不是用"我觉得"说话。
