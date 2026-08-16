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
 *      and the image blocks are replaced with text description blocks. The
 *      session log keeps the original image message (the GUI still shows the
 *      image); only the wire request is rewritten. Models with native image
 *      input (e.g. kimi-coding/k3) pass through untouched.
 *
 * Performance (v1.1, 2026-08-15):
 *   - Direct HTTP to https://api.kimi.com/coding/v1/chat/completions using
 *     the kimi-coding OAuth token from ~/.pi/agent/auth.json (no pi
 *     subprocess startup; ~2-4s saved per call). Falls back to the pi CLI.
 *   - `thinking: {type: "disabled"}`: kimi-for-coding otherwise streams long
 *     reasoning_content before any visible description (~2x slower).
 *   - Streaming with early abort once enough description text has arrived.
 *   - Prefetch: descriptions start as soon as the message enters the agent
 *     inbox (`agent/inbox/inserted`), overlapping pre-step/request assembly.
 *
 * Zero npm dependencies: only Node builtins (+ the `pi` CLI as fallback).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-plugin-kimi-vision";

/** Services this plugin reads via ctx (cordis requires explicit injection). */
export const inject = ["llm", "attachments"];

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = join(PLUGIN_DIR, ".status.json");
const DIAG_FILE = join(PLUGIN_DIR, ".diagnostics.log");
const HEARTBEAT_FILE = join(PLUGIN_DIR, ".heartbeat.log");
const VERSION = "1.2.0";

const KIMI_ENDPOINT = "https://api.kimi.com/coding/v1/chat/completions";
const KIMI_UA = "KimiCLI/1.5";
const AUTH_FILE = join(process.env.HOME ?? "", ".pi", "agent", "auth.json");

const DEFAULTS = {
  /**
   * Vision model. Benchmark (2026-08-15, direct HTTP + thinking off):
   *   kimi-coding/k3                       ~10.0s  (fastest; in $3 / out $15 per 1M)
   *   kimi-coding/kimi-for-coding (K2.7)   ~13.5s  (cheapest; in $0.95 / out $4)
   *   kimi-coding/kimi-for-coding-highspeed ~13.5s (2x K2.7 price)
   *   kimi-coding/k3-256k                  ~13.3s  (free via subscription)
   */
  model: "kimi-coding/k3",
  /** OpenAI-compatible endpoint for the vision call (future providers: 千问/豆包…). */
  endpoint: KIMI_ENDPOINT,
  /** Optional raw API key (Bearer). If empty, uses the kimi-coding OAuth token. */
  apiKey: "",
  language: "zh",
  piBin: "",
  /** Scratch dir for pi session files; empty = $TMPDIR/dsh-kimi-vision */
  sessionDir: "",
  /** Working dir for the pi subprocess (pi keys sessions by cwd). */
  cwd: "",
  timeoutMs: 180000,
  maxParallel: 4,
  maxDescriptionChars: 4000,
  maxContextChars: 2000,
  cacheFile: "",
  /** Vision transport: "http" (direct, fast) | "pi" (CLI) | "auto" (http→pi fallback). */
  transport: "auto",
  /** Send thinking:disabled so kimi-for-coding skips its reasoning phase. */
  disableThinking: true,
  /** Stop streaming once this many description chars arrived (0 = no abort). */
  abortAfterChars: 1200,
  /** Start describing images as soon as they enter the agent inbox. */
  prefetchOnInsert: true,
  /** Run pi with --no-tools so the vision model cannot call bash etc. */
  noTools: true,
  /** Extra pi CLI flags (array), appended before the image args. */
  piExtraArgs: [],
  /** Symlink node/npm/npx into ~/.pi/agent/bin so pi-spawned bash finds node. */
  ensureNodeInPiBin: true,
  /** Prepend the pi-node bin dir to the HOST process PATH (DSH bash inherits it). */
  extendHostPath: true
};

const PATCH_KEY = Symbol("kimi-vision:resolveModelInfo-patched");
const rewrittenRequests = new WeakSet();
/** attachmentId -> description (resolved). */
const descriptionCache = new Map();
/** attachmentId -> in-flight promise (dedupe concurrent identical images). */
const inFlight = new Map();
/** Captured original resolveModelInfo, before patching. */
let originalResolveModelInfo = null;
/** provider -> { textOnly: boolean } */
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

function imageBlocksOf(content) {
  return (Array.isArray(content) ? content.filter((b) => b?.type === "image") : []);
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
    writeFileSync(STATUS_FILE, JSON.stringify({
      ...extra,
      version: VERSION,
      pid: process.pid,
      at: new Date().toISOString()
    }, null, 2));
  } catch { /* never fatal */ }
}

function diagWrite(line) {
  try {
    mkdirSync(PLUGIN_DIR, { recursive: true });
    writeFileSync(DIAG_FILE, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
  } catch { /* never fatal */ }
}

function heartbeatWrite(line) {
  try {
    mkdirSync(PLUGIN_DIR, { recursive: true });
    writeFileSync(HEARTBEAT_FILE, `${new Date().toISOString()} ${line}\n`, { flag: "a" });
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

/**
 * pi's bash tool builds its shell env by prepending ~/.pi/agent/bin
 * (getBinDir) to pi's own PATH. That dir only holds `fd`, so on hosts with a
 * minimal PATH (Electron-launched DSH), any `node` invoked inside pi-spawned
 * bash fails with "bash: node: command not found". Symlink node/npm/npx into
 * that dir so bash always finds them, regardless of the inherited PATH.
 */
function ensurePiBinNode(cfg) {
  if (!cfg.ensureNodeInPiBin) return;
  try {
    const piBinDir = cfg._piBin ? dirname(cfg._piBin) : null;
    if (!piBinDir || !existsSync(piBinDir)) return;
    const home = process.env.HOME ?? "";
    const agentBin = join(home, ".pi", "agent", "bin");
    mkdirSync(agentBin, { recursive: true });
    for (const tool of ["node", "npm", "npx"]) {
      const src = join(piBinDir, tool);
      const dst = join(agentBin, tool);
      if (existsSync(dst) || !existsSync(src)) continue;
      try {
        symlinkSync(src, dst);
      } catch (error) {
        if (error?.code !== "EEXIST") diagWrite(`ensurePiBinNode: symlink ${tool} failed: ${String(error.message ?? error).slice(0, 160)}`);
      }
    }
  } catch (error) {
    diagWrite(`ensurePiBinNode: ${String(error.message ?? error).slice(0, 160)}`);
  }
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

/** Prepend the pi-node bin dir to the host process PATH (DSH bash inherits it). */
function extendHostPath(cfg) {
  if (!cfg.extendHostPath) return;
  const binDir = cfg._piBin ? dirname(cfg._piBin) : null;
  if (!binDir || !existsSync(binDir)) return;
  const current = process.env.PATH ?? "";
  if (current.split(":").includes(binDir)) return;
  process.env.PATH = [binDir, current].filter(Boolean).join(":");
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
/* Kimi auth (OAuth token from ~/.pi/agent/auth.json)                  */
/* ------------------------------------------------------------------ */

function readKimiAuth() {
  try {
    const parsed = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
    const entry = parsed?.["kimi-coding"];
    if (entry && typeof entry.access === "string" && entry.access) {
      return { access: entry.access, expires: typeof entry.expires === "number" ? entry.expires : 0 };
    }
  } catch { /* missing/unreadable */ }
  return null;
}

function kimiTokenExpired(auth, marginMs) {
  return auth.expires > 0 && Date.now() > auth.expires - marginMs;
}

/**
 * Refresh the kimi-coding OAuth token by running a trivial pi call (pi
 * refreshes the token at startup when needed and writes auth.json back).
 */
function refreshKimiAuth(cfg) {
  const piBin = cfg._piBin;
  if (!piBin) return Promise.resolve();
  return new Promise((resolve) => {
    const binDir = dirname(piBin);
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` };
    const child = spawn(piBin, [
      "-p", "--no-tools", "--no-extensions", "--no-skills",
      "--model", cfg.model, "--session-dir", scratchDir(cfg), "ok"
    ], { cwd: cfg.cwd || scratchDir(cfg), env, stdio: ["ignore", "ignore", "ignore"] });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 90000);
    child.on("close", () => { clearTimeout(timer); resolve(); });
    child.on("error", () => { clearTimeout(timer); resolve(); });
  });
}

/* ------------------------------------------------------------------ */
/* Kimi vision call: direct HTTP (fast) with pi CLI fallback           */
/* ------------------------------------------------------------------ */

function buildPrompt(cfg, contextText) {
  const lang = {
    zh: "中文",
    es: "español",
    en: "English"
  }[cfg.language] || cfg.language;
  const base =
    `请用${lang}描述这张图片：逐字转写图中所有文字（保留原文语言，注意西语重音符号），` +
    `并简要说明布局与关键元素。按从上到下顺序输出；不要编造；不要开场白或总结。`;
  if (!contextText) return base;
  return `${base}\n\n用户消息原文（仅作描述重点参考，不必转写）：\n${contextText}`;
}

function wireModelId(cfg) {
  // strip the provider prefix: "kimi-coding/kimi-for-coding" -> "kimi-for-coding"
  const slash = cfg.model.indexOf("/");
  return slash >= 0 ? cfg.model.slice(slash + 1) : cfg.model;
}

function sseParse(body, { onDelta, signal }) {
  const decoder = new TextDecoder();
  let pending = "";
  return (async () => {
    for await (const chunk of body) {
      signal?.throwIfAborted?.();
      pending += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        const delta = parsed?.choices?.[0]?.delta;
        if (typeof delta?.content === "string" && delta.content.length > 0) onDelta(delta.content);
      }
    }
  })();
}

/**
 * Direct HTTP vision call. Returns the description text.
 * On auth failure it refreshes the token once; on other failures it throws
 * so the caller can fall back to the pi CLI.
 */
async function kimiVisionHTTP(cfg, { base64, mediaType, prompt, signal }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    let token = typeof cfg.apiKey === "string" && cfg.apiKey ? cfg.apiKey : null;
    if (!token) {
      const auth = readKimiAuth();
      if (!auth) throw new Error("kimi-coding OAuth 凭证缺失（可设置 config.apiKey）");
      if (kimiTokenExpired(auth, 120000)) {
        heartbeatWrite("token expired, refreshing via pi");
        await refreshKimiAuth(cfg);
        const fresh = readKimiAuth();
        if (!fresh) throw new Error("kimi-coding OAuth 刷新失败");
        token = fresh.access;
      } else {
        token = auth.access;
      }
    }

    const buildBody = () => {
      const body = {
        model: wireModelId(cfg),
        max_tokens: 1200,
        stream: true,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } }
          ]
        }]
      };
      if (cfg.disableThinking) body.thinking = { type: "disabled" };
      return body;
    };

    const post = (bearer) => fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}`, "User-Agent": KIMI_UA },
      body: JSON.stringify(buildBody()),
      signal: controller.signal
    });

    let res = await post(token);

    if (res.status === 401 && !cfg.apiKey) {
      heartbeatWrite("HTTP 401, refreshing token and retrying");
      await refreshKimiAuth(cfg);
      const fresh = readKimiAuth();
      if (!fresh) throw new Error("kimi-coding OAuth 刷新失败（401 重试前）");
      token = fresh.access;
      res = await post(token);
    }

    if (!res.ok) {
      const errText = await res.text();
      // thinking param may be rejected by some models: retry without it
      if (cfg.disableThinking && /thinking/i.test(errText)) {
        const body = buildBody();
        delete body.thinking;
        res = await fetch(cfg.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": KIMI_UA },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      }
      if (!res.ok) throw new Error(`Kimi API HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    let text = "";
    let aborted = false;
    const abortTimer = cfg.abortAfterChars > 0 ? setTimeout(() => { aborted = true; controller.abort(); }, cfg.timeoutMs) : null;
    try {
      await sseParse(res.body, {
        signal,
        onDelta: (delta) => {
          text += delta;
          if (cfg.abortAfterChars > 0 && text.length >= cfg.abortAfterChars) {
            controller.abort(); // enough content: stop the stream early
          }
        }
      });
    } catch (error) {
      if (!aborted && signal?.aborted) throw error;
      // stream aborted by us (early stop) or by the turn: keep whatever we have
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
    }
    const out = text.trim();
    if (!out) throw new Error("Kimi API 返回空描述");
    return out;
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
  }
}

/** pi CLI fallback (original transport). */
function runPi(cfg, piBin, { imageFile, prompt, signal }) {
  return new Promise((resolve, reject) => {
    const binDir = dirname(piBin);
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` };
    const args = [
      "-p",
      ...(cfg.noTools ? ["--no-tools"] : []),
      "--no-extensions",
      "--no-skills",
      "--model", cfg.model,
      "--session-dir", scratchDir(cfg),
      ...(Array.isArray(cfg.piExtraArgs) ? cfg.piExtraArgs : []),
      `@${imageFile}`,
      prompt
    ];
    const child = spawn(piBin, args, {
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
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (signal?.aborted) { reject(signal.reason ?? new Error("aborted")); return; }
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
      heartbeatWrite(`describe start id=${id}`);
      ensurePiBinNode(cfg);
      const { data } = await ctx.attachments.readImage(ref, signal);
      const prompt = buildPrompt(cfg, contextText);
      const useHttp = cfg.transport === "http" || cfg.transport === "auto";
      let description = null;
      let httpFailed = null;
      if (useHttp) {
        try {
          description = await kimiVisionHTTP(cfg, {
            base64: Buffer.from(data).toString("base64"),
            mediaType: ref?.mediaType ?? "image/png",
            prompt,
            signal
          });
        } catch (error) {
          httpFailed = error;
          if (cfg.transport === "http") throw error; // strict http: no fallback
        }
      }
      if (description === null && cfg.transport !== "http" && cfg._piBin) {
        if (httpFailed) heartbeatWrite(`http failed (${String(httpFailed?.message ?? httpFailed).slice(0, 120)}), falling back to pi`);
        const dir = scratchDir(cfg);
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20)}.${extFor(ref?.mediaType)}`);
        writeFileSync(file, data);
        try {
          description = await runPi(cfg, cfg._piBin, { imageFile: file, prompt, signal });
        } finally {
          try { rmSync(file, { force: true }); } catch { /* best effort */ }
        }
      }
      if (description === null) {
        const reason = httpFailed ? String(httpFailed?.message ?? httpFailed).slice(0, 200) : "无可用识图通道";
        throw new Error(reason);
      }
      description = description.slice(0, cfg.maxDescriptionChars);
      descriptionCache.set(id, description);
      saveCacheFile(cfg._cacheFile);
      heartbeatWrite(`describe ok id=${id} len=${description.length}`);
      return description;
    } catch (error) {
      const reason = signal?.aborted
        ? "已取消"
        : String(error?.message ?? error).split("\n")[0].slice(0, 200);
      diagWrite(`describeImage failed id=${id} model=${cfg.model}: ${String(error?.message ?? error).slice(0, 400)}`);
      heartbeatWrite(`describe FAIL id=${id}: ${String(error?.message ?? error).slice(0, 200)}`);
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
    if (!cfg._piBin && cfg.transport !== "http") {
      error = "pi CLI 未找到且 transport 非 http：请设置 config.piBin 或改用 transport: http";
      logger?.warn?.(`[kimi-vision] ${error}`);
    } else {
      ensurePiBinNode(cfg);
      extendHostPath(cfg);
      patchModelInfo(ctx.llm, logger);

      // Prefetch: start describing images as soon as they enter the inbox.
      if (cfg.prefetchOnInsert) {
        ctx.on("agent/inbox/inserted", (payload) => {
          try {
            const message = payload?.message;
            const agent = payload?.agent;
            const images = message?.content ? imageBlocksOf(message.content) : [];
            if (images.length === 0) return;
            const routeProvider = agent?.options?.provider
              ?? agent?.session?.requestHeader?.()?.config?.provider;
            const routeModel = agent?.options?.model
              ?? agent?.session?.requestHeader?.()?.config?.model;
            const contextText = textOf(message.content).slice(0, cfg.maxContextChars);
            if (routeProvider && routeModel) {
              void isTextOnlyRoute(ctx.llm, routeProvider, routeModel).then((textOnly) => {
                if (!textOnly) return; // native vision model: images pass through
                for (const image of images) {
                  void describeImage(ctx, cfg, image, contextText, undefined);
                }
              }).catch(() => {
                for (const image of images) void describeImage(ctx, cfg, image, contextText, undefined);
              });
            } else {
              for (const image of images) void describeImage(ctx, cfg, image, contextText, undefined);
            }
          } catch (err) {
            logger?.warn?.(`[kimi-vision] prefetch failed: ${String(err?.message ?? err).slice(0, 200)}`);
          }
        });
      }

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
            return next(); // fail-open: the adapter surfaces its own clearer error
          }
        })();
      });

      logger?.info?.(`[kimi-vision] active: v${VERSION} model=${cfg.model} transport=${cfg.transport} pi=${cfg._piBin ?? "none"} language=${cfg.language}`);
    }
  } catch (err) {
    error = String(err?.message ?? err).split("\n")[0];
    try { ctx.logger?.warn?.(`[kimi-vision] init failed: ${error}`); } catch { /* ignore */ }
  }
  statusWrite({ applied: error === null, model: cfg.model, transport: cfg.transport, piBin: cfg._piBin ?? null, error });
}

export const __internals = {
  hasImageInContent,
  rewriteBlocks,
  rewriteMessages,
  buildPrompt,
  resolvePiBin,
  ensurePiBinNode,
  kimiVisionHTTP,
  DEFAULTS
};
