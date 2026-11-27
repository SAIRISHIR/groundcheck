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

// --- Stance check: code double-checks the judge's "supports"/"contradicts" --
//
// checkEvidence proves a quote is REAL and ON TOPIC, but the label the judge
// puts on it ("supports" or "contradicts") is still the judge's opinion. The
// helpers below re-check that label in code, so the safety claim "the AI
// never decides a verdict" also holds for the label:
//
//   1. The quote is widened to its whole sentence, so the judge can't drop
//      words like "no longer" by quoting only part of a sentence.
//   2. A sentence can only SUPPORT a claim if it contains every value the
//      claim asserts (numbers, percentages, years, months, multi-word names)
//      and does not negate it.
//   3. If the sentence states a different value of the same kind (another
//      date, another percentage), or negates exactly the claimed fact, the
//      label is changed to "contradicts".
//   4. A "contradicts" label on a sentence that states exactly the claimed
//      values, without negation, is thrown away as a mislabel.
//
// Jira records are skipped: they are structured one-line records, and the
// judge's stance on them is about status (Done vs In Progress), not values.

/**
 * Split text into sentences, also treating line breaks and table cells as
 * boundaries (storageToText puts one block per line).
 */
function sentencesOf(text) {
  return String(text ?? '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The whole sentence of `text` that contains `quote`. If the quote spans more
 * than one sentence (or can't be located), the quote itself is returned.
 */
export function expandToSentence(text, quote) {
  const q = squash(quote);
  if (!q) return String(quote ?? '');
  const hit = sentencesOf(text).find((s) => squash(s).includes(q));
  return hit ?? String(quote ?? '');
}

const MONTH_NUMBER = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * The values a sentence asserts, grouped by kind. Numbers glued to letters,
 * hyphens or colons ("v2", "2x", "DEMO-3", "10:00") are names or times, not
 * values, so they are skipped.
 *
 * "Launches on 5 December 2026 at 1.9%" ->
 *   { num: {"5"}, month: {"12"}, year: {"2026"}, pct: {"1.9"}, name: {} }
 *
 * @returns {{num: Set<string>, pct: Set<string>, year: Set<string>, month: Set<string>, name: Set<string>}}
 */
export function extractValues(text) {
  const out = { num: new Set(), pct: new Set(), year: new Set(), month: new Set(), name: new Set() };
  let s = String(text ?? '').replace(/[’‘]/g, "'");

  // ISO dates first (2026-12-05), then remove them so their parts aren't re-read.
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => {
    out.year.add(y);
    out.month.add(String(Number(m)));
    out.num.add(String(Number(d)));
    return ' ';
  });

  // "1.9 percent" is the same value as "1.9%".
  s = s.replace(/(\d)\s*(per\s*cent|percent)\b/gi, '$1%');

  // Ordinals ("5th December") are the same value as "5 December".
  const NUM = /(?<![\p{L}\d.,:\-])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)(?:st|nd|rd|th)?(?![\p{L}\d:\-])/gu;
  for (const m of s.matchAll(NUM)) {
    const whole = m[1].replace(/,/g, '');
    const value = m[2] ? `${whole}.${m[2]}` : whole;
    if (m[3] === '%') out.pct.add(value);
    else if (!m[2] && Number(whole) >= 1900 && Number(whole) <= 2100) out.year.add(whole);
    else out.num.add(String(Number(value)));
  }

  for (const w of s.toLowerCase().match(/\p{L}+/gu) ?? []) {
    // "may" is also a verb, so only count it next to a number ("5 May", "May 5").
    if (w === 'may') continue;
    if (MONTH_NUMBER[w]) out.month.add(String(MONTH_NUMBER[w]));
  }
  if (/\b\d{1,2}\s+May\b|\bMay\s+\d{1,2}\b/.test(s)) out.month.add('5');

  // Multi-word names: two or more capitalised words in a row ("Kevin Campbell",
  // "Apple Pay"). A capitalised word at the very start of a sentence is only
  // counted when the next word is capitalised too, which this pattern needs anyway.
  for (const m of s.matchAll(/\b[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)+/gu)) {
    out.name.add(m[0].toLowerCase());
  }
  return out;
}

// Words that turn a statement around. "not only" is a known false positive;
// it only makes the check more cautious (it rejects, never invents, support).
const NEGATION =
  /\b(not|never|no longer|cancel+ed|dropped|postponed|rejected|superseded|replaced|instead of|previously|formerly|used to|was planned|isn't|aren't|wasn't|weren't|won't|doesn't|don't|didn't|can't|cannot)\b/i;

/** Does this sentence negate or retract what it says? */
export const isNegated = (text) => NEGATION.test(String(text ?? '').replace(/[’‘]/g, "'"));

const VALUE_KINDS = ['num', 'pct', 'year', 'month'];

/** How many of the claim's values a piece of text contains. */
function valuesFound(claimValues, text) {
  const t = extractValues(text);
  let n = VALUE_KINDS.reduce((sum, k) => sum + [...claimValues[k]].filter((v) => t[k].has(v)).length, 0);
  n += [...claimValues.name].filter((name) => squash(text).includes(squash(name))).length;
  return n;
}

/**
 * The clause of `sentence` that carries the claimed values. Negation is only
 * judged inside this clause, so "launches on 5 December 2026, not 1 November"
 * still SUPPORTS "launches on 5 December 2026": the "not" belongs to the
 * other date.
 */
export function focusClause(claim, sentence) {
  const c = extractValues(claim);
  const clauses = String(sentence ?? '')
    .split(/,\s|;\s|\s[–—-]\s|\s\(|\b(?=but\b|whereas\b|however\b|although\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (clauses.length < 2) return String(sentence ?? '');
  let best = clauses[0];
  let bestN = -1;
  for (const clause of clauses) {
    const n = valuesFound(c, clause);
    if (n > bestN) {
      best = clause;
      bestN = n;
    }
  }
  // No clause holds any claimed value: fall back to the whole sentence.
  return bestN > 0 ? best : String(sentence ?? '');
}

/**
 * Re-check the judge's stance on one quote, in code (see the block comment above).
 *
 * @param {string} claim
 * @param {string} sentence the quote, widened to its whole sentence
 * @param {'supports'|'contradicts'} stance what the judge said
 * @param {string} [kind] 'jira' or 'confluence'
 * @returns {{stance: 'supports'|'contradicts', adjusted: boolean} | {stance: null, why: string}}
 */
export function crossCheckStance(claim, sentence, stance, kind = 'confluence') {
  if (kind === 'jira') return { stance, adjusted: false };

  const c = extractValues(claim);
  const q = extractValues(sentence);
  // Negation is judged in the clause that carries the claimed values only.
  const negationDiffers = isNegated(claim) !== isNegated(focusClause(claim, sentence));

  // Which claimed values are missing from the sentence, and is a DIFFERENT
  // value of the same kind there instead (a different date, a different %)?
  let missing = 0;
  let conflictingKind = false;
  for (const k of VALUE_KINDS) {
    const absent = [...c[k]].filter((v) => !q[k].has(v));
    missing += absent.length;
    if (absent.length && [...q[k]].some((v) => !c[k].has(v))) conflictingKind = true;
  }
  const missingNames = [...c.name].filter((n) => !q.name.has(n) && !squash(sentence).includes(squash(n)));
  const statesAllValues = missing === 0 && missingNames.length === 0;

  if (stance === 'supports') {
    if (conflictingKind) return { stance: 'contradicts', adjusted: true };
    if (!statesAllValues) {
      return { stance: null, why: 'the quote does not state the values the claim asserts' };
    }
    if (negationDiffers) {
      // The sentence states exactly this fact, but turned around
      // ("We no longer launch on 1 November 2025").
      return { stance: 'contradicts', adjusted: true };
    }
    return { stance: 'supports', adjusted: false };
  }

  // stance === 'contradicts'
  const claimHasValues = VALUE_KINDS.some((k) => c[k].size > 0);
  const extraSameKind = VALUE_KINDS.some((k) => c[k].size > 0 && [...q[k]].some((v) => !c[k].has(v)));
  if (claimHasValues && statesAllValues && !extraSameKind && !negationDiffers) {
    return { stance: null, why: 'the quote states the claimed values, so it cannot contradict the claim' };
  }
  return { stance: 'contradicts', adjusted: false };
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

/**
 * Is this document out of date? Jira records never are: they are live.
 * A page counts as out of date when Confluence itself marks it archived, or
 * when its title says so ("archived", "deprecated", "obsolete", "superseded").
 */
export const isArchivedDoc = (doc) =>
  doc?.kind !== 'jira' &&
  (doc?.status === 'archived' || /archiv|deprecated|obsolete|superseded/i.test(String(doc?.title ?? '')));

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
 * The same sentence turned around, for the live self-test: "not" is inserted
 * after the first auxiliary verb. "The launch is on 5 December" ->
 * "The launch is not on 5 December". Sentences that are already negated, or
 * have no auxiliary verb to negate, return null and are skipped.
 * @returns {string|null}
 */
export function negateSentence(sentence) {
  const s = String(sentence ?? '');
  if (isNegated(s)) return null;
  const m = /\b(is|are|was|were|will|can|must|should)\b/i.exec(s);
  if (!m) return null;
  const at = m.index + m[0].length;
  return `${s.slice(0, at)} not${s.slice(at)}`;
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
