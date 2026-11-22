/**
 * Groundcheck: pure text helpers and the deterministic evidence checks.
 *
 * Nothing in this file talks to Atlassian or an LLM, so it can be unit
 * tested on its own (see test/). The safety guarantees of the document
 * checker live here.
 */

// Words that carry no meaning for search ("the plan says we launch on...").
const STOPWORDS = new Set(
  ('a an and are as at be by did do does for from has have in is it its of on or our ' +
    'said say says that the their them then there these this to was we were will with ' +
    'would should could can not no yes you your i me my he she they his her who what ' +
    'when where which how why about into than so if but also only just all any each').split(' ')
);

/** Turn a claim into a short list of meaningful search words. */
export function keywords(text, max = 8) {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%.-]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, max);
}

const MONTHS = new Set(
  'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' ')
);

/**
 * The words that say what a claim is ABOUT, without the values it asserts.
 * "Checkout v2 launches on 1 November 2025" -> checkout, v2, launches.
 * We search on these, because a wrong value in the claim would otherwise
 * steer the search away from the very page that contradicts it.
 */
export function topicWords(text, max = 8) {
  return keywords(text, 50)
    .filter((w) => !/^\d[\d.,%]*$/.test(w) && !MONTHS.has(w))
    .slice(0, max);
}

/** Order search hits by how many claim words appear in their title and excerpt. */
export function rankHits(hits, words) {
  const score = (h) => {
    const hay = ` ${String(h.title ?? '')} ${String(h.excerpt ?? '')} `.toLowerCase();
    return words.filter((w) => hay.includes(w)).length;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}

/** Convert Confluence storage-format HTML to plain text, keeping structure. */
export function storageToText(html) {
  return String(html ?? '')
    .replace(/<\/(p|h\d|li|tr|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Lowercase and collapse whitespace and punctuation, for robust matching. */
const squash = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();

/** Pull the first JSON object out of the model's reply. */
export function parseJudgeReply(text) {
  const match = String(text ?? '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Deterministic checks on ONE piece of evidence the AI judge proposes:
 *   1. It must cite a document we actually gave it.
 *   2. Its quote must appear word for word in that document.
 *   3. Its quote must share meaningful words with the claim.
 *
 * @param {{id?: string, pageId?: string, quote: string}} item
 * @returns {{ok: true, page: object} | {ok: false, why: string}}
 */
export function checkEvidence(item, pages, claim) {
  const id = String(item?.id ?? item?.pageId ?? '');
  const page = pages.find((p) => p.id === id);
  if (!page) return { ok: false, why: 'the judge cited a document that was not provided' };
  const quote = squash(item.quote);
  if (quote.length < 8) return { ok: false, why: 'the judge gave no usable quote' };
  if (!squash(page.text).includes(quote)) {
    return { ok: false, why: 'the quoted evidence does not appear in the document' };
  }
  const claimWords = keywords(claim);
  const quoteWords = new Set(keywords(item.quote, 50));
  const overlap = claimWords.filter((w) => quoteWords.has(w)).length;
  if (overlap < Math.min(2, claimWords.length)) {
    return { ok: false, why: 'the quoted evidence is not about this claim' };
  }
  return { ok: true, page };
}

/**
 * Decide the final verdict from evidence that has ALREADY passed
 * checkEvidence. The judge's own one-word verdict is ignored: only quotes we
 * could verify count.
 *
 *   only "supports" quotes      -> verified
 *   only "contradicts" quotes   -> contradicted
 *   both                        -> conflict (the records disagree)
 *   none                        -> null (nothing verifiable)
 *
 * Out-of-date (archived) documents only count when nothing current gave
 * evidence, so an old plan can never outvote the current one.
 */
export function decideVerdict(items) {
  const basis = currentEvidence(items);
  const supports = basis.some((i) => i.stance === 'supports');
  const contradicts = basis.some((i) => i.stance === 'contradicts');
  if (supports && contradicts) return 'conflict';
  if (supports) return 'verified';
  if (contradicts) return 'contradicted';
  return null;
}

/** The evidence that decides a verdict: current documents, or archived ones if that's all there is. */
export function currentEvidence(items) {
  const current = items.filter((i) => !i.archived);
  return current.length ? current : items;
}

/** Is this document out of date? (Jira records never are: they are live.) */
export const isArchivedDoc = (doc) => doc?.kind !== 'jira' && /archiv|deprecated|obsolete/i.test(String(doc?.title ?? ''));

// --- Claims split from pasted text -----------------------------------------

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const CLAIM_FIELDS = new Set(['status', 'assignee', 'summary']);
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

/**
 * Keep only well-formed claims from the model's split, in the input shape
 * each checker expects. The model's output is untrusted, like agent input.
 * @returns {Array<{checker: 'jira'|'team'|'doc', input: object, claim: string}>}
 */
export function normaliseClaims(raw, max = 10) {
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (out.length >= max) break;
    if (c?.type === 'jira') {
      const issueKey = clip(c.issueKey, 32).toUpperCase();
      const field = clip(c.field, 20).toLowerCase();
      const claimedValue = clip(c.claimedValue, 500);
      if (ISSUE_KEY.test(issueKey) && CLAIM_FIELDS.has(field) && claimedValue) {
        out.push({ checker: 'jira', input: { issueKey, field, claimedValue }, claim: `${issueKey} ${field} is "${claimedValue}"` });
      }
    } else if (c?.type === 'team') {
      const person = clip(c.person, 100);
      const team = clip(c.team, 100);
      if (person && team) out.push({ checker: 'team', input: { person, team }, claim: `${person} is on ${team}` });
    } else if (c?.type === 'doc') {
      const claim = clip(c.claim, 500);
      if (claim.length >= 5) out.push({ checker: 'doc', input: { claim }, claim });
    }
  }
  return out;
}

// --- Live self-test helpers ------------------------------------------------

// A standalone number: not part of a name like "v2" or "2x", optionally a percentage.
const NUMBER = /(?<![\p{L}\d.,])(\d+(?:\.\d+)?)(%?)(?![\p{L}\d])/u;

/**
 * Sentences from a page that state something checkable with a number in it,
 * such as "Transaction fees stay at 1.9% per card payment."
 * @returns {string[]}
 */
export function numericSentences(text, max = 3) {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s*\|\s*/g, ' ').trim())
    .filter((s) => s.length >= 30 && s.length <= 220)
    .filter((s) => s.split(/\s+/).length >= 5)
    .filter((s) => NUMBER.test(s))
    // Skip sentences that talk to the reader or to an AI: they are instructions, not facts.
    .filter((s) => !/\b(ignore|instructions?|assistant|you should|please)\b/i.test(s))
    .slice(0, max);
}

/**
 * The same sentence with its first standalone number changed, so it states a
 * different value for the same fact: 1.9% -> 2.9%, 2026 -> 2027, 5 -> 7.
 * @returns {string|null} null when the sentence has no number to change.
 */
export function perturbNumber(sentence) {
  const m = NUMBER.exec(String(sentence ?? ''));
  if (!m) return null;
  const [whole, digits, percent] = m;
  let next;
  if (digits.includes('.')) {
    const places = digits.split('.')[1].length;
    next = (Number(digits) + 1).toFixed(places);
  } else {
    const n = Number(digits);
    if (n >= 1900 && n <= 2100) next = String(n + 1); // a year
    else if (n < 10) next = String(n + 2);
    else next = String(n + Math.max(1, Math.round(n * 0.4)));
  }
  return sentence.slice(0, m.index) + next + percent + sentence.slice(m.index + whole.length);
}

/**
 * One Jira issue as a single line of text the judge can quote, for example
 * "DEMO-3 | Add Google Pay to checkout | Story | Status: Done | Assignee: Mitch Davis".
 * Only structured fields are included, never the description, so text typed
 * into an issue cannot reach the judge.
 */
export function jiraRecordText(issue) {
  const f = issue?.fields ?? {};
  const parts = [
    issue?.key,
    f.summary,
    f.issuetype?.name,
    `Status: ${f.status?.name ?? 'unknown'}`,
    `Assignee: ${f.assignee?.displayName ?? 'Unassigned'}`,
  ];
  if (f.duedate) parts.push(`Due: ${f.duedate}`);
  return parts.filter(Boolean).join(' | ');
}

/**
 * Keep only issues whose summary contains at least two of the claim's topic
 * words (or all of them, if there are fewer), best matches first. This stops
 * an issue that merely shares one common word from being treated as related.
 */
export function relatedIssues(issues, words, max = 3) {
  const need = Math.min(2, words.length);
  const scored = issues
    .map((issue) => {
      const hay = ` ${String(issue?.fields?.summary ?? '').toLowerCase()} `;
      return { issue, score: words.filter((w) => hay.includes(w)).length };
    })
    .filter((s) => need > 0 && s.score >= need)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.issue);
}
