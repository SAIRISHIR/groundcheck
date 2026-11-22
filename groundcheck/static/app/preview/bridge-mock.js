/**
 * Local preview only: a stand-in for @forge/bridge so the screens can be
 * rendered and inspected outside Jira. Data mirrors the demo site (DEMO
 * project, GCD space) and the real resolver response shapes.
 * Never bundled into the Forge app (see vite.preview.config.js).
 */
import { EVAL_SET } from '../../../src/evalSet.js';

const now = Date.now();
const ago = (mins) => new Date(now - mins * 60000).toISOString().slice(0, 19).replace('T', ' ');

const mine = [
  { verdict: 'conflict', checker: 'confluence-judge', claim: 'Apple Pay ships before Google Pay', m: 4, ms: 6120,
    evidence: { source: 'documents', items: [
      { kind: 'confluence', id: '3342338', title: 'Checkout v2 decisions log', quote: 'Apple Pay ships before Google Pay.', stance: 'supports', url: '/wiki/x' },
      { kind: 'jira', id: 'jira:DEMO-3', title: 'DEMO-3 (Jira issue)', quote: 'DEMO-3 | Add Google Pay to checkout | Story | Status: Done', stance: 'contradicts', url: '/browse/DEMO-3' },
      { kind: 'jira', id: 'jira:DEMO-2', title: 'DEMO-2 (Jira issue)', quote: 'DEMO-2 | Add Apple Pay to checkout | Story | Status: In Progress', stance: 'contradicts', url: '/browse/DEMO-2' } ] } },
  { verdict: 'verified', checker: 'teamwork-graph', claim: 'Max Taylor is on Team Nova', m: 4, ms: 1840,
    evidence: { source: 'teamwork-graph', person: 'Max Taylor', teams: ['Team Nova', 'Mobile Dev', 'Platform Engineering'] } },
  { verdict: 'verified', checker: 'confluence-judge', claim: "The vendor's fee is 1.9% per card payment.", m: 5, ms: 5410,
    evidence: { source: 'documents', items: [{ kind: 'confluence', id: '3538945', title: 'Payments vendor call notes', quote: 'Transaction fees stay at 1.9% per card payment.', stance: 'supports', url: '/wiki/y' }] } },
  { verdict: 'contradicted', checker: 'jira-exact', claim: 'DEMO-9 status is "Done"', m: 5, ms: 612, issueKey: 'DEMO-9',
    evidence: { source: 'jira', issueKey: 'DEMO-9', field: 'status', actualValue: 'In Progress', url: '/browse/DEMO-9' } },
  { verdict: 'contradicted', checker: 'jira-exact', claim: 'DEMO-8 assignee is "Jennifer Evans"', m: 5, ms: 588, issueKey: 'DEMO-8',
    evidence: { source: 'jira', issueKey: 'DEMO-8', field: 'assignee', actualValue: 'Max Taylor', url: '/browse/DEMO-8' } },
  { verdict: 'contradicted', checker: 'confluence-judge', claim: 'Ryan Lee owns rollback', m: 6, ms: 7030,
    evidence: { source: 'documents', items: [{ kind: 'confluence', id: '3506177', title: 'Checkout v2 rollout plan', quote: 'Kevin Campbell owns rollback.', stance: 'contradicts', url: '/wiki/z' }] } },
  { verdict: 'contradicted', checker: 'confluence-judge', claim: 'Checkout v2 launches to all customers on 1 November 2025.', m: 6, ms: 6890,
    evidence: { source: 'documents', items: [{ kind: 'confluence', id: '3506177', title: 'Checkout v2 rollout plan', quote: 'Checkout v2 launches to all customers on 5 December 2026, ahead of the holiday sale.', stance: 'contradicts', url: '/wiki/z' }] } },
  { verdict: 'verified', checker: 'confluence-judge', claim: 'Guest checkout is deferred to Q1 2027', m: 200, ms: 4980,
    evidence: { source: 'documents', items: [{ kind: 'confluence', id: '3342338', title: 'Checkout v2 decisions log', quote: 'Guest checkout is deferred to Q1 2027.', stance: 'supports', url: '/wiki/x' }] } },
  { verdict: 'not_recorded', checker: 'confluence-judge', claim: 'The checkout v2 marketing budget is 2 million dollars', m: 210, ms: 5230, evidence: null },
  { verdict: 'verified', checker: 'jira-exact', claim: 'DEMO-3 status is "Done"', m: 1500, ms: 540, issueKey: 'DEMO-3',
    evidence: { source: 'jira', issueKey: 'DEMO-3', field: 'status', actualValue: 'Done', url: '/browse/DEMO-3' } },
  { verdict: 'verified', checker: 'jira-exact', claim: 'DEMO-17 assignee is "Ryan Lee"', m: 1510, ms: 498, issueKey: 'DEMO-17',
    evidence: { source: 'jira', issueKey: 'DEMO-17', field: 'assignee', actualValue: 'Ryan Lee', url: '/browse/DEMO-17' } },
  { verdict: 'not_recorded', checker: 'jira-exact', claim: 'DEMO-99 status is "Done"', m: 1512, ms: 402, issueKey: 'DEMO-99', evidence: null },
].map((r, i) => ({ id: `r${i}`, createdAt: ago(r.m), latencyMs: r.ms, issueKey: r.issueKey ?? null, ...r }));

// Site-wide counts are computed from the rows, so the numbers always agree.
const counts = [];
for (const r of mine) {
  const c = counts.find((x) => x.checker === r.checker && x.verdict === r.verdict);
  if (c) c.count += 1;
  else counts.push({ checker: r.checker, verdict: r.verdict, count: 1 });
}
const dayOf = (s) => s.slice(0, 10);
const timeline = Array.from({ length: 14 }, (_, i) => {
  const day = new Date(now - (13 - i) * 86400000).toISOString().slice(0, 10);
  const c = {};
  for (const r of mine) if (dayOf(r.createdAt) === day) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return { day, counts: c };
});
const sources = ['jira-exact', 'confluence-judge', 'teamwork-graph'].map((checker) => {
  const rows = mine.filter((r) => r.checker === checker);
  return {
    checker,
    total: rows.length,
    wrong: rows.filter((r) => r.verdict === 'contradicted' || r.verdict === 'conflict').length,
    avgMs: rows.length ? Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length) : null,
  };
});
console.assert(counts.reduce((s, c) => s + c.count, 0) === mine.length, 'counts add up to rows');
console.assert(timeline.reduce((s, d) => s + Object.values(d.counts).reduce((a, b) => a + b, 0), 0) === mine.length, 'timeline adds up');

const evalCases = EVAL_SET.map(({ id, checker, claim, expected, note }) => ({ id, checker, claim, expected, note }));

const handlers = {
  getDashboard: () => ({ mine, counts, usage: { used: 41, cap: 300 }, timeline, sources, retentionDays: 90, at: new Date().toISOString() }),
  getSystemStatus: () => ({
    jira: { ok: true, ms: 184 }, confluence: { ok: true, ms: 262 }, graph: { ok: true, ms: 341 },
    ai: { ok: true, ms: 120, detail: 'claude-haiku-4-5-20251001' }, at: new Date().toISOString(),
  }),
  getEvalCases: () => ({
    cases: evalCases,
    lastRun: { at: new Date(now - 3600000).toISOString(), results: evalCases.map((c, i) => ({ id: c.id, got: c.expected, pass: true, ms: c.checker === 'doc' ? 4800 + (i % 7) * 310 : 420 + (i % 5) * 60 })) },
  }),
  getIssueFacts: () => ({
    key: 'DEMO-8', summary: 'Show delivery estimate on order summary', type: 'Story', status: 'In Progress', statusCategory: 'indeterminate',
    assignee: 'Max Taylor', priority: 'Medium', dueDate: new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    updated: new Date(now - 3 * 3600000).toISOString(), graphAssignees: ['Max Taylor'], graphOk: true,
  }),
  getIssueReceipts: () => mine.filter((r) => r.issueKey === 'DEMO-8').concat(mine.slice(0, 2)),
  runEvalCase: ({ id }) => new Promise((res) => setTimeout(() => res({ id, got: evalCases.find((c) => c.id === id).expected, pass: true, ms: 500 }), 60)),
  saveEvalRun: ({ results }) => ({ at: new Date().toISOString(), results }),
  getSelfTest: () => ({ set: selfTest }),
  buildSelfTest: () => selfTest,
  runSelfTestCase: ({ id }) =>
    new Promise((res) => {
      const c = selfTest.cases.find((x) => x.id === id);
      setTimeout(() => res({ id, got: c.accept[0], pass: true, ms: c.checker === 'doc' ? 5200 : 480 }), 80);
    }),
  extractClaims: () => ({ ok: true, claims: sampleClaims }),
  checkClaim: ({ claim }) =>
    new Promise((res) => {
      const r = mine.find((m) => m.claim.startsWith(claim.input.claimedValue ? `${claim.input.issueKey}` : claim.input.claim ?? claim.input.person));
      setTimeout(() => res({ verdict: r?.verdict ?? 'not_recorded', reason: 'Sample result for the local preview.', evidence: r?.evidence ?? null, checkedBy: r?.checker, latencyMs: r?.latencyMs ?? 700 }), 300);
    }),
};

// A live self-test as the backend would build it from this site.
const selfTest = {
  at: new Date(now - 600000).toISOString(),
  cases: [
    { id: 'L01', checker: 'jira', claim: 'DEMO-18 status is "Backlog"', accept: ['verified'], note: 'from DEMO-18, true status' },
    { id: 'L02', checker: 'jira', claim: 'DEMO-18 status is "In Progress"', accept: ['contradicted'], note: 'from DEMO-18, real status is Backlog' },
    { id: 'L03', checker: 'jira', claim: 'DEMO-12 assignee is "Max Taylor"', accept: ['verified'], note: 'from DEMO-12, true assignee' },
    { id: 'L04', checker: 'jira', claim: 'DEMO-12 assignee is "Ryan Lee"', accept: ['contradicted'], note: 'from DEMO-12, real assignee is Max Taylor' },
    { id: 'L05', checker: 'doc', claim: 'Transaction fees stay at 1.9% per card payment.', accept: ['verified', 'conflict'], note: 'from "Payments vendor call notes", as written' },
    { id: 'L06', checker: 'doc', claim: 'Transaction fees stay at 2.9% per card payment.', accept: ['contradicted', 'conflict'], note: 'from "Payments vendor call notes", number changed' },
    { id: 'L07', checker: 'team', claim: 'SAI RISHI R is on Team Nova', accept: ['verified'], note: 'your own team' },
    { id: 'L08', checker: 'team', claim: 'SAI RISHI R is on Orbit Review Board', accept: ['contradicted'], note: 'a team you are not on' },
  ],
};

const sampleClaims = [
  { checker: 'doc', input: { claim: 'Checkout v2 launches to all customers on 1 November 2025.' }, claim: 'Checkout v2 launches to all customers on 1 November 2025.' },
  { checker: 'jira', input: { issueKey: 'DEMO-8', field: 'assignee', claimedValue: 'Jennifer Evans' }, claim: 'DEMO-8 assignee is "Jennifer Evans"' },
  { checker: 'doc', input: { claim: 'Apple Pay ships before Google Pay' }, claim: 'Apple Pay ships before Google Pay' },
  { checker: 'team', input: { person: 'Max Taylor', team: 'Team Nova' }, claim: 'Max Taylor is on Team Nova' },
];

export const invoke = async (name, payload) => handlers[name](payload ?? {});
export const view = {
  // issue.html (a copy of index.html made by the preview script) shows the issue panel.
  getContext: async () => ({
    moduleKey: location.pathname.endsWith('issue.html') ? 'groundcheck-issue-panel' : 'groundcheck-dashboard',
  }),
  theme: { enable: async () => {} },
};
export const router = { navigate: () => {} };
