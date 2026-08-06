/**
 * Local Ollama client for Sitrifor news editor.
 * Tuned for ~6GB RAM hosts: 1 concurrent job, low threads/ctx, short keep-alive.
 * Output is passed through editorial polish (typography + krrkt/mawo/speller gate).
 * Optional rewrite via NEWS_LLM_REWRITE_MODEL (e.g. larger local or remote model).
 * Art Lebedev Typograf is NOT used.
 */
import {
  EDITORIAL_STYLE_RU,
  REWRITE_STYLE_RU,
  editorialSystemPrompt,
  polishEditorialText,
  stripAiClichesJs,
  isReadableEnough,
  passesEditorialGate,
  isSoftGateFailure
} from './news-text-polish.js';
import { isBadAiText } from './news-quality.js';

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';
const REWRITE_MODEL = process.env.NEWS_LLM_REWRITE_MODEL || '';

const DEFAULT_OPTIONS = {
  num_thread: Number(process.env.OLLAMA_NUM_THREAD || 2),
  num_ctx: Number(process.env.OLLAMA_NUM_CTX || 2048),
  temperature: 0.35,
  top_p: 0.9,
  repeat_penalty: 1.15
};

let queue = Promise.resolve();
let busy = false;

function enqueue(fn) {
  const run = queue.then(async () => {
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  });
  // Keep the chain alive even if a job fails
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function llmBusy() {
  return busy;
}

export async function isLlmAvailable() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const data = await res.json();
    const models = data?.models || [];
    if (!models.length) return false;
    if (models.some((m) => m.name === DEFAULT_MODEL || m.model === DEFAULT_MODEL)) return true;
    // Accept any loaded model name if exact match missing (tag variants)
    return models.some((m) => String(m.name || '').startsWith('qwen2.5:1.5b'));
  } catch {
    return false;
  }
}

export async function unloadModel(model = DEFAULT_MODEL) {
  try {
    await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0, prompt: '' })
    });
  } catch {
    /* ignore */
  }
}

async function rawChat(messages, { model, options, keepAlive, signal }) {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      keep_alive: keepAlive,
      options: { ...DEFAULT_OPTIONS, ...options }
    })
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error('[news-llm] chat failed', res.status, err.slice(0, 200));
    return null;
  }
  const data = await res.json();
  return data?.message?.content?.trim() || null;
}

/**
 * Optional second pass with a stronger model (NEWS_LLM_REWRITE_MODEL).
 * Skipped when unset – 7b usually doesn't fit beside 1.5b on ~6GB hosts.
 */
export async function llmRewrite(text, opts = {}) {
  const model = opts.model || REWRITE_MODEL;
  if (!model || !text || process.env.NEWS_LLM_REWRITE === '0') return text;
  return enqueue(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 240000);
    try {
      const out = await rawChat(
        [
          { role: 'system', content: opts.system || REWRITE_STYLE_RU },
          {
            role: 'user',
            content: `Перепиши текст. Сохрани markdown и URL.\n\n---\n${text}\n---`
          }
        ],
        {
          model,
          options: { temperature: 0.25, ...(opts.options || {}) },
          keepAlive: opts.keepAlive || '2m',
          signal: ctrl.signal
        }
      );
      if (!out || out.length < 40 || isBadAiText(out)) return text;
      return out;
    } catch (e) {
      console.error('[news-llm] rewrite error', e.message || e);
      return text;
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Polish + editorial gate. Soft-retries once on AI-cliché / em-dash only.
 * @returns {{ text: string|null, polish: object|null, recovered: boolean }}
 */
export function finalizeLlmText(raw, opts = {}) {
  if (!raw || raw.length < 40) return { text: null, polish: null, recovered: false };
  // Strip fluff before cliché/AI gates so soft drafts can recover
  let draft = stripAiClichesJs(String(raw)).replace(/\u2014/g, '–');
  if (isBadAiText(draft)) {
    console.error('[news-llm] output failed AI-cliché/bad gate');
    return { text: null, polish: null, recovered: false };
  }
  const deep = opts.deep ?? process.env.NEWS_TEXT_POLISH !== '0';
  let polished = polishEditorialText(draft, { deep, stripCliches: false, ...opts });
  let recovered = draft !== String(raw).trim();

  if (
    (!passesEditorialGate(polished) || !isReadableEnough(polished.text) || isBadAiText(polished.text)) &&
    (isSoftGateFailure(polished) || (polished.hints || []).includes('ai_cliche'))
  ) {
    const stripped = stripAiClichesJs(polished.text).replace(/\u2014/g, '–');
    if (stripped && stripped !== polished.text) {
      const again = polishEditorialText(stripped, { deep, stripCliches: false, ...opts });
      if (
        passesEditorialGate(again) &&
        isReadableEnough(again.text) &&
        !isBadAiText(again.text)
      ) {
        polished = again;
        recovered = true;
      }
    }
  }

  if (!isReadableEnough(polished.text) || isBadAiText(polished.text)) {
    console.error('[news-llm] output failed readability gate', polished.hints || []);
    return { text: null, polish: polished, recovered };
  }
  if (!passesEditorialGate(polished)) {
    console.error(
      '[news-llm] output failed editorial gate',
      polished.infoScore,
      polished.gate?.reasons || polished.hints || []
    );
    return { text: null, polish: polished, recovered };
  }
  return { text: polished.text, polish: polished, recovered };
}

function finalizeText(raw, opts = {}) {
  return finalizeLlmText(raw, opts).text;
}

/**
 * Chat completion via Ollama.
 * @returns {Promise<string|null>}
 */
export async function llmChat(
  messages,
  {
    model = DEFAULT_MODEL,
    options = {},
    keepAlive = '2m',
    timeoutMs = 180000,
    rewrite = Boolean(REWRITE_MODEL),
    finalize = true,
    mode = null
  } = {}
) {
  return enqueue(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // Inject mode system prompt if caller passed mode and no system message yet
      let msgs = messages;
      if (mode && Array.isArray(messages) && !messages.some((m) => m.role === 'system')) {
        msgs = [{ role: 'system', content: editorialSystemPrompt(mode) }, ...messages];
      }

      let text = await rawChat(msgs, {
        model,
        options,
        keepAlive,
        signal: ctrl.signal
      });
      if (!text || text.length < 40) return null;

      if (rewrite && REWRITE_MODEL) {
        // Nested enqueue would deadlock – call raw rewrite path inline
        try {
          const rewritten = await rawChat(
            [
              { role: 'system', content: REWRITE_STYLE_RU },
              {
                role: 'user',
                content: `Перепиши текст. Сохрани markdown и URL.\n\n---\n${text}\n---`
              }
            ],
            {
              model: REWRITE_MODEL,
              options: { temperature: 0.25, ...options },
              keepAlive,
              signal: ctrl.signal
            }
          );
          if (rewritten && rewritten.length >= 40 && !isBadAiText(rewritten)) {
            text = rewritten;
          }
        } catch (e) {
          console.error('[news-llm] inline rewrite skipped', e.message || e);
        }
      }

      if (finalize === false) return text;
      return finalizeText(text);
    } catch (e) {
      console.error('[news-llm] chat error', e.message || e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Single-prompt generate (simpler for short tasks).
 */
export async function llmGenerate(prompt, opts = {}) {
  const system = opts.system || (opts.mode ? editorialSystemPrompt(opts.mode) : EDITORIAL_STYLE_RU);
  return llmChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    opts
  );
}

/**
 * Structured JSON-ish extract: ask for markdown, parse sections heuristically.
 */
export function parseMarkdownSections(text) {
  if (!text) return {};
  const sections = {};
  let current = 'intro';
  sections[current] = [];
  for (const line of text.split(/\n/)) {
    const h = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (h) {
      current = h[1].toLowerCase().replace(/\s+/g, '_').slice(0, 60);
      sections[current] = sections[current] || [];
      continue;
    }
    sections[current].push(line);
  }
  for (const k of Object.keys(sections)) {
    sections[k] = sections[k].join('\n').trim();
  }
  return sections;
}

export function getLlmConfig() {
  return {
    host: OLLAMA_HOST,
    model: DEFAULT_MODEL,
    rewriteModel: REWRITE_MODEL || null,
    options: { ...DEFAULT_OPTIONS },
    modes: Object.keys(
      // lazy import shape without circular risk – mirror known modes
      {
        editorial: 1,
        social: 1,
        tips: 1,
        insights: 1,
        sarcasm: 1,
        review: 1,
        birthday: 1,
        soft: 1,
        rewrite: 1
      }
    )
  };
}
