/**
 * Groundcheck: guarded access to Forge LLMs.
 *
 * Forge LLMs run Claude models hosted by Atlassian, so no data leaves the
 * platform (the app stays eligible for "Runs on Atlassian"). There is no free
 * allowance: the developer pays for every token. So every call goes through
 * `callLlm`, which enforces a daily call cap stored in Forge KVS and keeps the
 * output short.
 */
import { chat, list } from '@forge/llm';
import { kvs } from '@forge/kvs';

// Most calls should be cheap and fast. Haiku first, Sonnet as a fallback if
// Haiku has been retired on the platform.
const PREFERRED_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];

// Hard ceiling on LLM calls per site per day (UTC). At roughly 3k input and
// 300 output tokens per call on Haiku, 300 calls cost well under US$2.
export const DAILY_CALL_CAP = 300;

let cachedModel = null;

/** Pick the first preferred model that the platform lists as active. */
async function pickModel() {
  if (cachedModel) return cachedModel;
  try {
    const { models = [] } = await list();
    const active = new Set(models.filter((m) => m.status === 'active').map((m) => m.model));
    cachedModel = PREFERRED_MODELS.find((m) => active.has(m)) ?? PREFERRED_MODELS[0];
  } catch (e) {
    console.warn('Could not list Forge LLM models, using default', e?.message);
    cachedModel = PREFERRED_MODELS[0];
  }
  return cachedModel;
}

const usageKey = () => `llm-calls:${new Date().toISOString().slice(0, 10)}`;

/**
 * Count one call against today's cap.
 * @returns {Promise<boolean>} false when the cap is already reached.
 */
async function takeFromBudget() {
  const key = usageKey();
  const used = (await kvs.get(key)) ?? 0;
  if (used >= DAILY_CALL_CAP) return false;
  // Not atomic, so a burst can overshoot by a call or two. That is fine for
  // a soft budget; the cap exists to stop runaway costs, not to bill exactly.
  await kvs.set(key, used + 1);
  return true;
}

/** How many LLM calls have been used today (for the admin dashboard). */
export async function usageToday() {
  return { used: (await kvs.get(usageKey())) ?? 0, cap: DAILY_CALL_CAP };
}

/**
 * Send one system + user prompt and return the reply text.
 *
 * @returns {Promise<{ok: true, text: string, model: string} | {ok: false, reason: string}>}
 */
export async function callLlm({ system, user, maxTokens = 400 }) {
  if (!(await takeFromBudget())) {
    return { ok: false, reason: `Daily AI check limit (${DAILY_CALL_CAP}) reached. Try again tomorrow.` };
  }
  const first = await pickModel();
  // If the first attempt fails (an outage, a timeout, a retired model), try
  // once more with the other model. Both attempts count as one budget call.
  const attempts = [first, ...PREFERRED_MODELS.filter((m) => m !== first)].slice(0, 2);
  let lastError = null;
  for (const model of attempts) {
    try {
      const response = await withTimeout(
        chat({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_completion_tokens: maxTokens,
          temperature: 0, // Same input, same verdict, as far as the model allows.
        }),
        CALL_TIMEOUT_MS
      );
      const content = response?.choices?.[0]?.message?.content;
      // Content is either a plain string or a list of text parts.
      const text = Array.isArray(content) ? content.map((p) => p?.text ?? '').join('') : String(content ?? '');
      return { ok: true, text, model };
    } catch (e) {
      lastError = e;
      console.warn(`Forge LLM call failed on ${model}`, e?.message, e?.context?.responseText);
    }
  }
  console.error('Forge LLM unavailable after retry', lastError?.message);
  return { ok: false, reason: 'The AI judge is unavailable right now.' };
}

// A Forge function has 25 seconds in total. Searching and reading pages take
// a few of them, so one model call may use at most this many.
const CALL_TIMEOUT_MS = 8000;

/** Reject if `promise` takes longer than `ms`. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Which model the judge will use, and whether the platform lists it as
 * active. Uses the free model list, never a paid chat call.
 */
export async function judgeModelStatus() {
  try {
    const { models = [] } = await list();
    const active = models.filter((m) => m.status === 'active').map((m) => m.model);
    const model = PREFERRED_MODELS.find((m) => active.includes(m)) ?? null;
    return { ok: Boolean(model), model };
  } catch (e) {
    return { ok: false, model: null, error: e?.message };
  }
}
