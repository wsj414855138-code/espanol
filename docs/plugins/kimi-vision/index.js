/**
 * dsh-plugin-kimi-vision — DSH host-side plugin.
 *
 * Lets text-only models (DeepSeek 等) "read" the images the user attaches in
 * the Web GUI, by bridging them to the Kimi vision model:
 *
 *   1. Patch `ctx.llm.resolveModelInfo` so text-only providers advertise
 *      `inputModalities: ["text", "image"]`. Without this, DSH's
 *      session.prompt image-admission check rejects the message with
 *      "Model ... does not support image input" before it ever reaches the
 *      inbox (dsh-host-apiproxy).
 *
 *   2. Hook the `llm/stream` waterfall: when a request carries image blocks
 *      and the target model is text-only, each image is described by Kimi
 *      (via the `pi` CLI, which uses the OAuth credentials in ~/.pi), and the
 *      image blocks are replaced with text description blocks. The session
 *      log keeps the original image message (the GUI still shows the image);
 *      only the wire request is rewritten. Models with native image input
 *      (e.g. kimi-coding/k3) pass through untouched.
 *
 * Zero npm dependencies: only Node builtins + the `pi` CLI binary.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-plugin-kimi-vision";

/** Services this plugin reads via ctx (cordis requires explicit injection). */
export const inject = ["llm", "attachments"];

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = join(PLUGIN_DIR, ".status.json");
const DEFAULTS = {
  model: "kimi-coding/kimi-for-coding",
  language: "zh",
  piBin: "",
  /** Scratch dir for pi session files; empty = $TMPDIR/dsh-kimi-vision */
  sessionDir: "",
  /**
   * Working directory for the pi subprocess. pi keys its session storage by
   * cwd, so pointing this at a project dir makes vision calls ride on that
   * project's past pi conversations (~/.pi/agent/sessions/...).
   * Empty = scratch dir (no cross-talk with past sessions).
   */
  cwd: "",
  timeoutMs: 180000,
  maxParallel: 4,
  maxDescriptionChars: 4000,
  maxContextChars: 2000,
  cacheFile: ""
};

const PATCH_KEY = Symbol("kimi-vision:resolveModelInfo-patched");
const REWRITTEN = Symbol("kimi-vision:rewritten-request");

/** Guard set: request objects this plugin already rewrote (recursion fence). */
const rewrittenRequests = new WeakSet();
/** attachmentId -> description (resolved). */
const descriptionCache = new Map();
/** attachmentId -> in-flight promise (dedupe concurrent identical images). */
const inFlight = new Map();
/** Captured original resolveModelInfo, before patching. */
let originalResolveModelInfo = null;
/** provider -> { textOnly: boolean } (stable per provider in practice). */
const textOnlyCache = new Map();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function hasImageInContent(blocks) {
  return Array.isArray(blocks) && blocks.some((b) =>
    b?.type === "image" || (b?.type === "tool-result" && hasImageInContent(b?.content))
  );
}

function textOf(blocks) {
  return (Array.isArray(blocks) ? blocks.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "").trim();
}

function extFor(mediaType) {
  switch (mediaType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    default: return "img";
  }
}

function scratchDir(cfg) {
  return cfg.sessionDir || join(tmpdir(), "dsh-kimi-vision");
}

function statusWrite(extra) {
  try {
    mkdirSync(PLUGIN_DIR, { recursive: true });
    writeFileSync(STATUS_FILE, JSON.stringify({ ...extra, at: new Date().toISOString() }, null, 2));
  } catch { /* never fatal */ }
}

function loadCacheFile(cfg) {
  const file = cfg.cacheFile || join(scratchDir(cfg), "kimi-vision-cache.json");
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.descriptions) {
      for (const [id, desc] of Object.entries(parsed.descriptions)) {
        if (typeof id === "string" && typeof desc === "string") descriptionCache.set(id, desc);
      }
    }
  } catch { /* first run or missing file: fine */ }
  return file;
}

function saveCacheFile(file) {
  try {
    const entries = [...descriptionCache.entries()];
    if (entries.length > 500) {
      for (const [id] of entries.slice(0, entries.length - 500)) descriptionCache.delete(id);
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ descriptions: Object.fromEntries(descriptionCache) }));
  } catch { /* never fatal */ }
}

/** Locate the pi CLI binary: explicit config -> PATH -> known pi-node installs. */
function resolvePiBin(cfg) {
  if (cfg.piBin) {
    try { if (existsSync(cfg.piBin)) return cfg.piBin; } catch { /* fall through */ }
  }
  try {
    for (const dir of (process.env.PATH ?? "").split(":")) {
      if (!dir) continue;
      const candidate = join(dir, "pi");
      try { if (existsSync(candidate)) return candidate; } catch { /* keep looking */ }
    }
  } catch { /* fall through */ }
  try {
    const home = process.env.HOME ?? "";
    const root = join(home, ".local", "share", "pi-node");
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, "bin", "pi");
      try { if (existsSync(candidate)) return candidate; } catch { /* keep looking */ }
    }
  } catch { /* no pi-node install */ }
  return null;
}

/** Patch resolveModelInfo so text-only routes admit image prompts (admission check). */
function patchModelInfo(llm, logger) {
  if (!llm || typeof llm.resolveModelInfo !== "function" || llm[PATCH_KEY]) return;
  originalResolveModelInfo = llm.resolveModelInfo;
  Object.defineProperty(llm, PATCH_KEY, { value: true, configurable: true });
  llm.resolveModelInfo = async function resolveModelInfo(provider, model, signal) {
    const info = await originalResolveModelInfo.call(llm, provider, model, signal);
    if (info && Array.isArray(info.inputModalities) && !info.inputModalities.includes("image")) {
      return { ...info, inputModalities: [...info.inputModalities, "image"] };
    }
    return info;
  };
  logger?.info?.("[kimi-vision] resolveModelInfo patched: text-only models now admit image prompts");
}

/** True when the ORIGINAL adapter metadata says this route is text-only. */
async function isTextOnlyRoute(llm, provider, model) {
  const key = `${provider}/${model}`;
  if (textOnlyCache.has(key)) return textOnlyCache.get(key);
  let textOnly = true;
  try {
    const info = originalResolveModelInfo
      ? await originalResolveModelInfo.call(llm, provider, model)
      : await llm.resolveModelInfo(provider, model);
    textOnly = !(Array.isArray(info?.inputModalities) && info.inputModalities.includes("image"));
  } catch { /* unknown -> assume text-only so we still bridge */ }
  textOnlyCache.set(key, textOnly);
  return textOnly;
}

/* ------------------------------------------------------------------ */
/* Kimi vision call (pi CLI)                                           */
/* ------------------------------------------------------------------ */

function buildPrompt(cfg, contextText) {
  const lang = {
    zh: "中文",
    es: "español",
    en: "English"
  }[cfg.language] || cfg.language;
  const base =
    `你是一个图像描述助手。请仔细查看这张图片，用${lang}给出详细、准确的描述，` +
    `供一个无法看到图片的 AI 助手理解。要求：\n` +
    `1) 逐字转写图片中所有可见的文字（保留原文语言，西语/中文都照抄，注意重音符号和特殊字符）；\n` +
    `2) 说明图片类型（截图 / 照片 / 文档页 / 图表 / UI 等）和整体布局；\n` +
    `3) 描述关键元素、颜色、位置关系；\n` +
    `4) 文字较多时，按从上到下、从左到右的顺序整理成结构化文本（用列表/分段）；\n` +
    `5) 不要编造图片里没有的内容；不确定的地方明确说明。`;
  if (!contextText) return base;
  return `${base}\n\n用户的消息原文（供你理解描述重点，不需要转写它）：\n${contextText}`;
}

function runPi(cfg, piBin, { imageFile, prompt, signal }) {
  return new Promise((resolve, reject) => {
    const binDir = dirname(piBin);
    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`
    };
    const child = spawn(piBin, [
      "-p",
      "--no-extensions",
      "--no-skills",
      "--model", cfg.model,
      "--session-dir", scratchDir(cfg),
      `@${imageFile}`,
      prompt
    ], {
      cwd: cfg.cwd || scratchDir(cfg),
      env,
      signal,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      reject(new Error(`pi vision timed out after ${cfg.timeoutMs}ms`));
    }, cfg.timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-3).join(" | ");
        reject(new Error(`pi exited with code ${code}${tail ? `: ${tail}` : ""}`));
        return;
      }
      const out = stdout.trim();
      if (!out) reject(new Error("pi returned an empty description"));
      else resolve(out);
    });
  });
}

async function describeImage(ctx, cfg, image, contextText, signal) {
  const ref = image?.attachment;
  const id = ref?.attachmentId;
  if (typeof id !== "string" || !id) return "（图片缺少附件引用，无法识别）";
  if (descriptionCache.has(id)) return descriptionCache.get(id);
  if (inFlight.has(id)) return inFlight.get(id);
  const promise = (async () => {
    try {
      const { data } = await ctx.attachments.readImage(ref, signal);
      const dir = scratchDir(cfg);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}.${extFor(ref?.mediaType)}`);
      writeFileSync(file, data);
      let description;
      try {
        description = await runPi(cfg, cfg._piBin, { imageFile: file, prompt: buildPrompt(cfg, contextText), signal });
      } finally {
        try { rmSync(file, { force: true }); } catch { /* best effort */ }
      }
      description = description.slice(0, cfg.maxDescriptionChars);
      descriptionCache.set(id, description);
      saveCacheFile(cfg._cacheFile);
      return description;
    } catch (error) {
      const reason = signal?.aborted
        ? "已取消"
        : String(error?.message ?? error).split("\n")[0].slice(0, 200);
      return `[图片识别失败：${reason}]`;
    }
  })();
  inFlight.set(id, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(id);
  }
}

/* ------------------------------------------------------------------ */
/* request rewriting                                                   */
/* ------------------------------------------------------------------ */

/**
 * Replace image blocks with Kimi description text blocks (recursing into
 * tool-result content). Returns the same blocks array when nothing changed.
 */
async function rewriteBlocks(ctx, cfg, blocks, contextText, signal) {
  if (!Array.isArray(blocks) || !blocks.some((b) => b?.type === "image")) return blocks;
  const result = [];
  let changed = false;
  for (const block of blocks) {
    if (block?.type === "image") {
      const description = await describeImage(ctx, cfg, block, contextText, signal);
      const label = typeof block.attachment?.name === "string" && block.attachment.name
        ? block.attachment.name
        : "图片";
      result.push({
        type: "text",
        text: `[📷 ${label} · Kimi 视觉识别]\n${description}`
      });
      changed = true;
    } else if (block?.type === "tool-result" && hasImageInContent(block?.content)) {
      const inner = await rewriteBlocks(ctx, cfg, block.content, "", signal);
      if (inner !== block.content) {
        result.push({ ...block, content: inner });
        changed = true;
      } else {
        result.push(block);
      }
    } else {
      result.push(block);
    }
  }
  return changed ? result : blocks;
}

async function rewriteMessages(ctx, cfg, messages, signal) {
  let changed = false;
  const result = [];
  for (const message of messages ?? []) {
    if (!hasImageInContent(message?.content)) {
      result.push(message);
      continue;
    }
    const contextText = textOf(message.content).slice(0, cfg.maxContextChars);
    const newContent = await rewriteBlocks(ctx, cfg, message.content, contextText, signal);
    if (newContent !== message.content) {
      result.push({ ...message, content: newContent });
      changed = true;
    } else {
      result.push(message);
    }
  }
  return changed ? result : messages;
}

/* ------------------------------------------------------------------ */
/* plugin entry                                                        */
/* ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) };
  let error = null;
  try {
    cfg._piBin = resolvePiBin(cfg);
    cfg._cacheFile = loadCacheFile(cfg);
    const logger = ctx.logger;
    if (!cfg._piBin) {
      error = "pi CLI 未找到：请设置 config.piBin 为 pi 可执行文件路径（如 ~/.local/share/pi-node/*/bin/pi）";
      logger?.warn?.(`[kimi-vision] ${error}`);
    } else {
      patchModelInfo(ctx.llm, logger);

      ctx.on("llm/stream", (options, next) => {
        if (rewrittenRequests.has(options)) return next();
        if (!options?.messages?.some((m) => hasImageInContent(m?.content))) return next();
        return (async () => {
          try {
            const textOnly = await isTextOnlyRoute(ctx.llm, options.provider, options.model);
            if (!textOnly) return next(); // native vision model: pass images through
            const messages = await rewriteMessages(ctx, cfg, options.messages, options.signal);
            if (messages === options.messages) return next();
            const rewritten = { ...options, messages };
            rewrittenRequests.add(rewritten);
            return ctx.llm.stream(rewritten);
          } catch (err) {
            logger?.warn?.(`[kimi-vision] rewrite failed: ${String(err?.message ?? err).slice(0, 300)}`);
            if (options.signal?.aborted) throw err;
            // fail-open: hand the original request back; the adapter will
            // surface its own (clearer) error to the turn.
            return next();
          }
        })();
      });

      logger?.info?.(`[kimi-vision] active: model=${cfg.model} pi=${cfg._piBin} language=${cfg.language}`);
    }
  } catch (err) {
    error = String(err?.message ?? err).split("\n")[0];
    try { ctx.logger?.warn?.(`[kimi-vision] init failed: ${error}`); } catch { /* ignore */ }
  }
  statusWrite({ applied: error === null, model: cfg.model, piBin: cfg._piBin ?? null, error });
}

export const __internals = {
  hasImageInContent,
  rewriteBlocks,
  rewriteMessages,
  buildPrompt,
  resolvePiBin,
  DEFAULTS
};
