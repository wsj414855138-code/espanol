#!/usr/bin/env node
/**
 * ocr.mjs — 教材拍照 OCR 的 Node 包装（调用 scripts/ocr.swift，零 npm 依赖）
 *
 * 用法：
 *   node scripts/ocr.mjs <图片路径>                      # 直接把识别文本打印到终端
 *   node scripts/ocr.mjs <图片路径> --out <输出txt路径>   # 识别文本写入文件
 *   node scripts/ocr.mjs <图片路径> --out <输出路径> --to-source
 *                                                       # 额外生成 source.md 模板骨架
 *                                                       # （三张表表头 + 底部附 OCR 原文，方便边看边整理）
 *   node scripts/ocr.mjs <图片路径> --lang zh-Hans,es-ES # 自定义识别语言（默认 zh-Hans + es-ES）
 *
 * 依赖 macOS 自带 Vision 框架（Xcode Command Line Tools 即可，无需 Xcode 本体）。
 * 优先用 `xcrun swift` 调用，失败则回退到 `swift`；两者都不可用时会给出安装提示。
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SWIFT_SCRIPT = join(ROOT, 'scripts', 'ocr.swift');

const SOURCE_TEMPLATE_HEADER = `# 课程标题（待填：来自教材第 X 课）

> meta: level=A1, source=教材《书名》第 X 课

> 整理说明：把下面"OCR 原文"里的内容逐行搬进上面三张表——
> 词汇表放生词（西语 + 中文），听辨表放最小对立对（如 b/v：baca/vaca），
> 句型表放完整句子；整理完删除"OCR 原文"小节，即可交给 build-pack.mjs。
`;

const SOURCE_TEMPLATE_TABLES = `
## 词汇
| 西语 | 中文 | 例句（西语） | 例句（中文） |
|---|---|---|---|

## 听辨
| 类别 | 词A | 词B | 中文说明 |
|---|---|---|---|

## 句型
| 西语 | 中文 |
|---|---|

`;

function printUsage() {
  console.log(`用法：node scripts/ocr.mjs <图片路径> [选项]

选项：
  --out <路径>            把识别文本写入文件（默认打印到终端）
  --to-source             在 --out 文件旁额外生成 <文件名>.source.md 模板骨架
  --lang <zh-Hans,es-ES>  指定识别语言（逗号分隔，默认 zh-Hans,es-ES）
  --help                  显示本帮助`);
}

function parseArgs(argv) {
  const opts = { image: null, out: null, toSource: false, lang: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else if (a === '--out') {
      if (i + 1 >= argv.length) {
        console.error('✗ --out 后面需要跟输出文件路径');
        process.exit(1);
      }
      opts.out = argv[++i];
    } else if (a === '--to-source') {
      opts.toSource = true;
    } else if (a === '--lang') {
      if (i + 1 >= argv.length) {
        console.error('✗ --lang 后面需要跟语言标签（如 zh-Hans,es-ES）');
        process.exit(1);
      }
      opts.lang = argv[++i];
    } else if (a.startsWith('--')) {
      console.error(`✗ 未知参数：${a}`);
      printUsage();
      process.exit(1);
    } else if (opts.image === null) {
      opts.image = a;
    } else {
      console.error(`✗ 多余参数：${a}`);
      printUsage();
      process.exit(1);
    }
  }
  return opts;
}

/**
 * 调用 Swift OCR 脚本。
 * 优先 `xcrun swift`（可找到 SDK 头文件），失败再试 `swift`；
 * 两者都找不到时说明环境缺 Xcode Command Line Tools，给出安装指引。
 */
function runSwift(swiftArgs) {
  const attempts = [
    { cmd: 'xcrun', args: ['swift', SWIFT_SCRIPT, ...swiftArgs] },
    { cmd: 'swift', args: [SWIFT_SCRIPT, ...swiftArgs] },
  ];
  let lastError = null;
  for (const { cmd, args } of attempts) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 300_000 });
    if (r.error) {
      // 命令本身不存在（如没装 CLT）→ 尝试下一个候选；否则是真正的运行错误
      if (r.error.code === 'ENOENT') {
        lastError = `找不到命令 ${cmd}`;
        continue;
      }
      if (r.error.code === 'ETIMEDOUT') {
        console.error('✗ OCR 超时（首次运行 Swift 需要编译，请稍后再试或增大超时）');
        process.exit(1);
      }
      lastError = r.error.message;
      continue;
    }
    if (r.status === 0) return { ok: true, stdout: r.stdout };
    // swift 成功启动但脚本报错（如图片打不开）→ 这是真实失败，直接报错不再回退
    console.error(`✗ OCR 脚本执行失败（退出码 ${r.status}）：`);
    if (r.stderr) console.error(r.stderr.trimEnd());
    if (r.stdout) console.error(r.stdout.trimEnd());
    return { ok: false };
  }
  console.error(`✗ 无法调用 Swift：${lastError}`);
  console.error('  本工具依赖 macOS 系统自带的 Swift 与 Vision 框架。');
  console.error('  请先安装 Xcode Command Line Tools：xcode-select --install');
  console.error('  （装好后运行 `swift --version` 确认可用，再重试本命令）');
  return { ok: false };
}

// 生成 source.md 模板骨架：三张表头 + 底部附 OCR 原文，方便边看边整理
function buildSourceTemplate(ocrText) {
  return (
    SOURCE_TEMPLATE_HEADER +
    SOURCE_TEMPLATE_TABLES +
    `## OCR 原文（识别结果，待整理）\n` +
    '```\n' +
    ocrText.trimEnd() +
    '\n```\n'
  );
}

// ---------- 主流程 ----------
const opts = parseArgs(process.argv.slice(2));

if (!opts.image) {
  console.error('✗ 缺少图片路径参数');
  printUsage();
  process.exit(1);
}

const imagePath = resolve(opts.image);
if (!existsSync(imagePath)) {
  console.error(`✗ 图片不存在：${imagePath}`);
  process.exit(1);
}

// 拼 Swift 侧参数：图片路径 + 语言标签
const swiftArgs = [imagePath];
if (opts.lang) {
  swiftArgs.push(...opts.lang.split(',').map((s) => s.trim()).filter(Boolean));
}

const result = runSwift(swiftArgs);
if (!result.ok) process.exit(1);

const text = result.stdout;
const lineCount = text.trim() ? text.trim().split('\n').length : 0;

if (!opts.out) {
  // 无 --out：直接打印识别结果
  process.stdout.write(text);
  if (lineCount === 0) console.error('提示：未识别到任何文字，请检查图片是否清晰。');
  process.exit(lineCount > 0 ? 0 : 1);
}

// 写 OCR 文本文件
const outPath = resolve(opts.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, text);
console.log(`✓ 识别完成（${lineCount} 行），已写入：${outPath}`);

// 额外生成 source.md 模板骨架
if (opts.toSource) {
  const skeletonPath = join(dirname(outPath), basename(outPath, extname(outPath)) + '.source.md');
  writeFileSync(skeletonPath, buildSourceTemplate(text));
  console.log(`✓ 已生成 source.md 模板骨架：${skeletonPath}`);
  console.log('  接下来：把 OCR 原文整理进三张表 → 改名为 source.md 放进 data/raw/<课程>/');
}

process.exit(lineCount > 0 ? 0 : 1);
