/**
 * Groundcheck: resolvers for the issue panel and the dashboard page.
 *
 * The React frontend calls these with `invoke('<name>')` from @forge/bridge.
 * They run on Forge's servers, so they can call Atlassian APIs safely.
 */
import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { GRAPH_QUERIES, runGraphQuery, nodeName, workItemAri, userAri } from './graph.js';
import {
  listMyReceipts,
  verdictCounts,
  verdictTimeline,
  checkerStats,
  purgeOldReceipts,
  reportAndEraseClosedAccounts,
  RETENTION_DAYS,
} from './receipts.js';
import { usageToday, judgeModelStatus } from './llm.js';
import { kvs } from '@forge/kvs';
import { checkers, checkAndRecord } from './actions.js';
import { extractClaims } from './extract.js';
import { normaliseClaims } from './text.js';
import { EVAL_SET } from './evalSet.js';
import { buildSelfTest, loadSelfTest } from './selftest.js';

const resolver = new Resolver();

// The issue's status and assignee, read from Jira AS THE USER, plus the
// assignee as Teamwork Graph sees it, so the panel can show whether they agree.
resolver.define('getIssueFacts', async ({ context }) => {
  const key = context.extension.issue.key;
  const issueId = context.extension.issue.id;

  const [res, graph] = await Promise.all([
    api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${key}?fields=status,assignee,summary,priority,duedate,updated,issuetype`),
    runGraphQuery(GRAPH_QUERIES.workItemAssignee, { itemId: workItemAri(context.cloudId, issueId) }),
  ]);
  if (!res.ok) throw new Error(`Jira returned HTTP ${res.status}`);
  const { fields } = await res.json();

  if (graph.errors.length) console.warn('Teamwork Graph errors', JSON.stringify(graph.errors).slice(0, 500));
  return {
    key,
    summary: fields.summary ?? null,
    type: fields.issuetype?.name ?? null,
    status: fields.status?.name ?? null,
    statusCategory: fields.status?.statusCategory?.key ?? null, // new | indeterminate | done
    assignee: fields.assignee?.displayName ?? null,
    priority: fields.priority?.name ?? null,
    dueDate: fields.duedate ?? null,
    updated: fields.updated ?? null,
    graphAssignees: graph.nodes.map(nodeName).filter(Boolean),
    graphOk: graph.errors.length === 0,
  };
});

// The current user's receipts for this issue. Never anyone else's: a receipt
// may quote a page that only its author can read.
resolver.define('getIssueReceipts', async ({ context }) => {
  return listMyReceipts(context.accountId, { issueKey: context.extension.issue.key, limit: 10 });
});

// Everything the dashboard page shows.
resolver.define('getDashboard', async ({ context }) => {
  const [mine, counts, usage, timeline, sources] = await Promise.all([
    listMyReceipts(context.accountId, { limit: 50 }),
    verdictCounts(),
    usageToday(),
    verdictTimeline(14),
    checkerStats(),
  ]);
  return { mine, counts, usage, timeline, sources, retentionDays: RETENTION_DAYS, at: new Date().toISOString() };
});

/** Time one probe and report whether it worked. Never throws. */
async function probe(fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: detail?.ok !== false, ms: Date.now() - started, detail: detail?.detail ?? null };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, detail: String(e?.message ?? e).slice(0, 120) };
  }
}

// Live health of every source Groundcheck checks against, as the current
// user. The dashboard shows it as a status line. No paid AI call is made.
resolver.define('getSystemStatus', async ({ context }) => {
  const [jira, confluence, graph, ai] = await Promise.all([
    probe(async () => {
      const res = await api.asUser().requestJira(route`/rest/api/3/myself`);
      return { ok: res.ok };
    }),
    probe(async () => {
      const res = await api.asUser().requestConfluence(route`/wiki/rest/api/search?cql=${'type = page'}&limit=1`);
      return { ok: res.ok };
    }),
    probe(async () => {
      const r = await runGraphQuery(GRAPH_QUERIES.userTeams, { userId: userAri(context.accountId) });
      return { ok: r.errors.length === 0 };
    }),
    probe(async () => {
      const s = await judgeModelStatus();
      return { ok: s.ok, detail: s.model };
    }),
  ]);
  return { jira, confluence, graph, ai, at: new Date().toISOString() };
});

// ---------------------------------------------------------------------------
// Accuracy eval: run the known-answer claims in src/evalSet.js through the
// real checkers. The page runs one case per call, so each call stays well
// inside the resolver time limit. Eval runs do not create receipts.
// ---------------------------------------------------------------------------

const EVAL_KEY = 'eval:last-run';

resolver.define('getEvalCases', async () => {
  const lastRun = await kvs.get(EVAL_KEY);
  return {
    cases: EVAL_SET.map(({ id, checker, claim, expected, note }) => ({ id, checker, claim, expected, note })),
    lastRun: lastRun ?? null,
  };
});

resolver.define('runEvalCase', async ({ payload }) => {
  const testCase = EVAL_SET.find((c) => c.id === payload?.id);
  if (!testCase) throw new Error('Unknown eval case');
  const started = Date.now();
  let result;
  try {
    result = await checkers[testCase.checker](testCase.input);
  } catch (e) {
    console.error(`Eval case ${testCase.id} failed`, e);
    result = { verdict: 'error', reason: String(e?.message ?? e).slice(0, 200) };
  }
  const pass = result.verdict === testCase.expected;
  // Failures go to the app log too, so they can be read with `forge logs`.
  if (!pass) {
    console.log(`EVAL FAIL ${testCase.id}: expected ${testCase.expected}, got ${result.verdict}: ${result.reason}`);
  }
  return {
    id: testCase.id,
    got: result.verdict,
    pass,
    reason: String(result.reason ?? '').slice(0, 400),
    ms: Date.now() - started,
  };
});

// Keep only the summary of the latest run (ids, verdicts, pass/fail), so the
// page can show it later without re-running. No evidence text is stored.
resolver.define('saveEvalRun', async ({ payload }) => {
  const known = new Set(EVAL_SET.map((c) => c.id));
  const results = (Array.isArray(payload?.results) ? payload.results : [])
    .filter((r) => known.has(r?.id))
    .map((r) => ({
      id: r.id,
      got: String(r.got).slice(0, 20),
      pass: Boolean(r.pass),
      ms: Number.isFinite(r.ms) ? Math.round(r.ms) : null,
    }));
  const run = { at: new Date().toISOString(), results };
  await kvs.set(EVAL_KEY, run);
  console.log(`EVAL RUN ${results.filter((r) => r.pass).length}/${results.length} correct`);
  return run;
});

// ---------------------------------------------------------------------------
// "Check an answer" box: split pasted text into claims (one AI call), then
// the page checks each claim with its own call, so every call stays well
// inside the 25-second limit.
// ---------------------------------------------------------------------------

resolver.define('extractClaims', async ({ payload }) => extractClaims(payload?.text));

resolver.define('checkClaim', async ({ payload, context }) => {
  // The claim comes back from the browser, so validate it again here.
  const raw = payload?.claim;
  const [claim] = normaliseClaims(raw ? [{ type: raw.checker, ...raw.input }] : [], 1);
  if (!claim) throw new Error('That claim is not in a form Groundcheck can check.');
  const result = await checkAndRecord(claim.checker, claim.input, claim.claim, context.accountId);
  return { claim: claim.claim, checker: claim.checker, ...result };
});

// ---------------------------------------------------------------------------
// Live self-test: a test generated from this site's own data (selftest.js).
// ---------------------------------------------------------------------------

// Wrapped in an object: a bare null does not always reach the page as null.
resolver.define('getSelfTest', async ({ context }) => ({ set: (await loadSelfTest(context.accountId)) ?? null }));

resolver.define('buildSelfTest', async ({ context }) => buildSelfTest(context.accountId));

resolver.define('runSelfTestCase', async ({ payload, context }) => {
  const set = await loadSelfTest(context.accountId);
  const testCase = set?.cases?.find((c) => c.id === payload?.id);
  if (!testCase) throw new Error('Unknown self-test case. Generate a new test.');
  const started = Date.now();
  let result;
  try {
    result = await checkers[testCase.checker](testCase.input);
  } catch (e) {
    console.error(`Self-test case ${testCase.id} failed`, e);
    result = { verdict: 'error', reason: String(e?.message ?? e).slice(0, 200) };
  }
  const pass = testCase.accept.includes(result.verdict);
  if (!pass) console.log(`SELFTEST MISS ${testCase.id} (${testCase.checker}): accept ${testCase.accept.join('|')}, got ${result.verdict}`);
  return { id: testCase.id, got: result.verdict, pass, reason: String(result.reason ?? '').slice(0, 400), ms: Date.now() - started };
});

export const handler = resolver.getDefinitions();

/**
 * Daily scheduled job: delete receipts past the retention period, then report
 * stored account IDs to Atlassian and erase data for closed accounts.
 */
export async function purgeReceipts() {
  await purgeOldReceipts();
  try {
    const { reported, erased } = await reportAndEraseClosedAccounts();
    console.log(JSON.stringify({ event: 'privacy-report', reported, erased }));
  } catch (e) {
    // A failed report is retried by tomorrow's run.
    console.error('Personal data report failed', e?.status ?? e?.message);
  }
}
