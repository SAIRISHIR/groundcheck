/**
 * Groundcheck: live self-test on the site's own data.
 *
 * The demo eval (evalSet.js) only makes sense on the demo site. This builds a
 * fresh test from whatever the current user can see on THIS site:
 *
 *   - Jira: for a few recent issues, the true status and assignee, and a
 *     changed version of each (another status or person seen on the site).
 *   - Confluence: for a few recent pages, a sentence with a number in it, and
 *     the same sentence with the number changed.
 *   - Teamwork Graph: one of the user's own teams, and a team they are not on.
 *
 * True claims must come back Verified; changed ones Contradicted. Every claim
 * is generated from live data, so nothing is hardcoded. The generated set is
 * stored per user in Forge KVS and run case by case, so the browser never
 * sends the claims itself.
 */
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { readPage } from './confluence.js';
import { GRAPH_QUERIES, runGraphQuery, nodeName, userAri } from './graph.js';
import { numericSentences, perturbNumber } from './text.js';

const JIRA_ISSUES = 4; // 4 issues x (status true/false + assignee true/false) = up to 16 cases
const PAGES = 3; // 3 pages x (true + changed sentence) = up to 6 AI-judged cases

const storeKey = (accountId) => `selftest:${accountId}`;

/** Spread `n` picks evenly across a list. */
const spread = (list, n) => {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
};

/** Build Jira cases from recently updated issues the user can see. */
async function jiraCases() {
  const jql = 'updated >= -180d ORDER BY updated DESC';
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=status,assignee,summary&maxResults=40`);
  if (!res.ok) return [];
  const issues = (await res.json()).issues ?? [];
  const statuses = [...new Set(issues.map((i) => i.fields?.status?.name).filter(Boolean))];
  const people = [...new Set(issues.map((i) => i.fields?.assignee?.displayName).filter(Boolean))];

  const cases = [];
  for (const issue of spread(issues, JIRA_ISSUES)) {
    const key = issue.key;
    const status = issue.fields?.status?.name;
    const assignee = issue.fields?.assignee?.displayName ?? 'Unassigned';
    const from = `from ${key}`;

    if (status) {
      cases.push(jiraCase(key, 'status', status, ['verified'], `${from}, true status`));
      const other = statuses.find((s) => s !== status) ?? (status === 'Done' ? 'To Do' : 'Done');
      cases.push(jiraCase(key, 'status', other, ['contradicted'], `${from}, real status is ${status}`));
    }
    cases.push(jiraCase(key, 'assignee', assignee, ['verified'], `${from}, true assignee`));
    const otherPerson = people.find((p) => p !== assignee);
    if (otherPerson) {
      cases.push(jiraCase(key, 'assignee', otherPerson, ['contradicted'], `${from}, real assignee is ${assignee}`));
    }
  }
  return cases;
}

const jiraCase = (issueKey, field, claimedValue, accept, note) => ({
  checker: 'jira',
  input: { issueKey, field, claimedValue },
  claim: `${issueKey} ${field} is "${claimedValue}"`,
  accept,
  note,
});

/** Build Confluence cases from recently modified pages the user can read. */
async function docCases() {
  const cql = 'type = page ORDER BY lastmodified DESC';
  const res = await api.asUser().requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=25`);
  if (!res.ok) return [];
  const hits = ((await res.json()).results ?? [])
    .map((r) => ({ id: String(r?.content?.id ?? ''), title: r?.content?.title ?? '' }))
    .filter((h) => h.id && !/archiv|deprecated|obsolete/i.test(h.title));

  const cases = [];
  // Read pages one at a time until we have enough pages with a usable
  // sentence, looking at no more than 10 pages to stay well inside the time limit.
  for (const hit of hits.slice(0, 10)) {
    if (cases.length >= PAGES * 2) break;
    const page = await readPage(hit.id);
    const sentence = page && numericSentences(page.text, 1)[0];
    const changed = sentence && perturbNumber(sentence);
    if (!sentence || !changed) continue;
    const from = `from "${page.title}"`;
    // A true sentence that another record disagrees with is correctly a conflict.
    cases.push({ checker: 'doc', input: { claim: sentence }, claim: sentence, accept: ['verified', 'conflict'], note: `${from}, as written` });
    cases.push({ checker: 'doc', input: { claim: changed }, claim: changed, accept: ['contradicted', 'conflict'], note: `${from}, number changed` });
  }
  return cases;
}

/** Build Teamwork Graph cases from the current user's own teams. */
async function teamCases(accountId) {
  const me = await api.asUser().requestJira(route`/rest/api/3/myself`);
  if (!me.ok) return [];
  const { displayName } = await me.json();
  const { nodes, errors } = await runGraphQuery(GRAPH_QUERIES.userTeams, { userId: userAri(accountId) });
  const teams = nodes.map(nodeName).filter(Boolean);
  if (errors.length || teams.length === 0 || !displayName) return [];

  const notMine = ['Orbit Review Board', 'Harbor Data Guild', 'Lantern Ops Crew'].find(
    (t) => !teams.some((mine) => mine.toLowerCase() === t.toLowerCase())
  );
  return [
    { checker: 'team', input: { person: displayName, team: teams[0] }, claim: `${displayName} is on ${teams[0]}`, accept: ['verified'], note: 'your own team' },
    { checker: 'team', input: { person: displayName, team: notMine }, claim: `${displayName} is on ${notMine}`, accept: ['contradicted'], note: 'a team you are not on' },
  ];
}

/**
 * Generate a new self-test for the current user and store it.
 * @returns {Promise<{at: string, cases: Array}>}
 */
export async function buildSelfTest(accountId) {
  const [jira, doc, team] = await Promise.all([
    jiraCases().catch(() => []),
    docCases().catch(() => []),
    teamCases(accountId).catch(() => []),
  ]);
  const cases = [...jira, ...doc, ...team].map((c, i) => ({ id: `L${String(i + 1).padStart(2, '0')}`, ...c }));
  const set = { at: new Date().toISOString(), cases };
  await kvs.set(storeKey(accountId), set);
  return set;
}

/** The current user's stored self-test, or null. */
export const loadSelfTest = (accountId) => kvs.get(storeKey(accountId));
