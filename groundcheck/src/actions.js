/**
 * Groundcheck: Rovo actions.
 *
 * A Rovo "action" is a tool that a Rovo agent can call. Rovo hands us the
 * inputs declared in manifest.yml (inside `payload`), we do the work, and
 * whatever we return is shown to the agent, which explains it to the user.
 *
 * There are three checkers, each verifying ONE claim:
 *   - checkJiraClaim: an issue's status, assignee or summary, by exact comparison.
 *   - checkDocClaim:  anything written in Confluence, compared with related
 *                     Jira issues too, via the AI judge (judge.js).
 *   - checkTeamClaim: team membership, via Teamwork Graph.
 */
import api, { route } from '@forge/api';
import { searchPages, readPage } from './confluence.js';
import { judgeClaim } from './judge.js';
import { searchRelatedIssues } from './jira.js';
import { GRAPH_QUERIES, runGraphQuery, nodeName, userAri } from './graph.js';
import { saveReceipt } from './receipts.js';

// The issue fields this checker knows how to verify, and how to read each one
// out of the Jira REST API response.
const SUPPORTED_FIELDS = {
  status: (fields) => fields.status?.name ?? null,
  // "Unassigned" is a recorded fact, so a claim that someone owns an
  // unassigned issue is contradicted, not "not recorded".
  assignee: (fields) => fields.assignee?.displayName ?? 'Unassigned',
  summary: (fields) => fields.summary ?? null,
};

// Jira issue keys look like "PROJ-123". We validate before calling Jira,
// because agent input is untrusted (it comes from an LLM).
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;

// Make comparisons forgiving about case, spacing and punctuation:
// "In progress" should match "In Progress".
const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Build a uniform verdict object. Every checker in Groundcheck returns this
 * same shape, so the agent and the UI can treat all claims the same way.
 */
const verdict = (status, reason, evidence = null, checkedBy = 'jira-exact') => ({
  // 'verified' | 'contradicted' | 'conflict' | 'not_recorded' | 'not_checked' | 'invalid_input'
  // ('conflict' means two records disagree, for example a plan and Jira.)
  verdict: status,
  reason,
  evidence,
  checkedBy,
});

async function checkJiraClaim(payload) {
  const issueKey = String(payload?.issueKey ?? '').trim().toUpperCase();
  const field = String(payload?.field ?? '').trim().toLowerCase();
  let claimedValue = String(payload?.claimedValue ?? '').trim();
  // People say "nobody" or "no one" for an unassigned issue.
  if (field === 'assignee' && /^(nobody|no one|none|unassigned)$/i.test(claimedValue)) {
    claimedValue = 'Unassigned';
  }

  // 1. Validate input before touching Jira.
  if (!ISSUE_KEY_PATTERN.test(issueKey)) {
    return verdict('invalid_input', `"${issueKey}" is not a valid Jira issue key.`);
  }
  if (!SUPPORTED_FIELDS[field]) {
    return verdict(
      'invalid_input',
      `Field "${field}" is not supported. Use one of: ${Object.keys(SUPPORTED_FIELDS).join(', ')}.`
    );
  }
  if (!claimedValue || claimedValue.length > 500) {
    return verdict('invalid_input', 'claimedValue must be between 1 and 500 characters.');
  }

  // 2. Read the issue AS THE USER, so we never reveal an issue they cannot see.
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=status,assignee,summary`);

  // 404 means the issue doesn't exist OR the user can't see it. We treat both
  // as "not recorded" and deliberately don't say which (to avoid leaking data).
  if (response.status === 404) {
    return verdict('not_recorded', `No issue ${issueKey} is visible to you in Jira.`);
  }
  if (!response.ok) {
    console.error(`Jira returned ${response.status} for ${issueKey}`);
    return verdict('not_recorded', `Jira could not be checked right now (HTTP ${response.status}).`);
  }

  const issue = await response.json();
  const actualValue = SUPPORTED_FIELDS[field](issue.fields);
  const evidence = {
    source: 'jira',
    issueKey,
    field,
    actualValue,
    url: `/browse/${issueKey}`,
  };

  // 3. Compare the claim with what Jira actually records.
  if (actualValue === null) {
    return verdict('not_recorded', `${issueKey} has no ${field} recorded.`, evidence);
  }
  if (normalise(actualValue) === normalise(claimedValue)) {
    return verdict('verified', `${issueKey} ${field} is "${actualValue}", as claimed.`, evidence);
  }
  return verdict(
    'contradicted',
    `Claim says ${field} is "${claimedValue}", but Jira shows "${actualValue}".`,
    evidence
  );
}

/**
 * Check one claim against Confluence pages, for example
 * "The rollout plan says checkout v2 launches on 5 December".
 *
 * Exact fields (status, assignee) are compared in code. Free text in pages
 * needs judgement, so an LLM proposes a verdict and a quote, and code then
 * verifies that the quote really is in the page (see judge.js).
 */
async function checkDocClaim(payload) {
  const claim = String(payload?.claim ?? '').trim();
  const pageTitle = String(payload?.pageTitle ?? '').trim();
  const by = 'confluence-judge';

  if (claim.length < 5 || claim.length > 500) {
    return verdict('invalid_input', 'claim must be between 5 and 500 characters.', null, by);
  }
  if (pageTitle.length > 200) {
    return verdict('invalid_input', 'pageTitle must be at most 200 characters.', null, by);
  }

  // Look in the named page if given, otherwise search; fall back to search
  // if the title matched nothing.
  // At the same time, find Jira issues about the same topic, so the plan in
  // Confluence can be compared with what is actually happening in Jira.
  const [firstHits, issues] = await Promise.all([
    searchPages(claim, pageTitle || null),
    searchRelatedIssues(claim),
  ]);
  let hits = firstHits;
  if (hits.length === 0 && pageTitle) hits = await searchPages(claim, null);

  const pages = (await Promise.all(hits.map((h) => readPage(h.id)))).filter(Boolean);
  if (pages.length === 0 && issues.length === 0) {
    return verdict('not_recorded', 'No Confluence page or Jira issue you can see mentions this.', null, by);
  }

  const result = await judgeClaim(claim, [...pages, ...issues]);
  return verdict(result.verdict, result.reason, result.evidence, by);
}

// Turn a person's name into a Jira account, as the user. Returns null when
// nobody (or more than one person with no exact match) fits the name.
async function findPerson(name) {
  const res = await api.asUser().requestJira(route`/rest/api/3/user/search?query=${name}&maxResults=10`);
  if (!res.ok) return null;
  const people = (await res.json()).filter((u) => u.accountType === 'atlassian' && u.active);
  const exact = people.filter((u) => normalise(u.displayName) === normalise(name));
  if (exact.length === 1) return exact[0];
  return people.length === 1 ? people[0] : null;
}

/**
 * Check a claim that a person is (or is not) on a team, using Teamwork Graph,
 * for example "Max Taylor is on the Platform Support team".
 */
async function checkTeamClaim(payload) {
  const person = String(payload?.person ?? '').trim();
  const team = String(payload?.team ?? '').trim();
  const by = 'teamwork-graph';

  if (!person || person.length > 100 || !team || team.length > 100) {
    return verdict('invalid_input', 'person and team must each be 1 to 100 characters.', null, by);
  }

  const user = await findPerson(person);
  if (!user) {
    return verdict('not_recorded', `Could not identify exactly one person named "${person}".`, null, by);
  }

  const { nodes, errors } = await runGraphQuery(GRAPH_QUERIES.userTeams, { userId: userAri(user.accountId) });
  if (errors.length) {
    // The graph could not be queried (for example the query is not available
    // on this site). That says nothing about the claim, so don't call it
    // "not recorded": say plainly that it was not checked.
    console.warn('Teamwork Graph errors', JSON.stringify(errors).slice(0, 500));
    return verdict('not_checked', 'Teamwork Graph could not be queried on this site, so team membership was not checked.', null, by);
  }
  const teams = nodes.map(nodeName).filter(Boolean);
  const evidence = { source: 'teamwork-graph', person: user.displayName, teams };

  // Allow "Platform Support" to match "Platform Support team" and vice versa.
  const teamCore = (s) => normalise(s).replace(/\bteam\b/g, ' ').replace(/\s+/g, ' ').trim();
  const wanted = teamCore(team);
  const match = teams.find((t) => teamCore(t) === wanted);

  if (match) {
    return verdict('verified', `${user.displayName} is on ${match}.`, evidence, by);
  }
  if (teams.length === 0) {
    // An empty answer can mean a missing scope or permission, not "no teams".
    return verdict('not_recorded', `No team memberships for ${user.displayName} are visible to you.`, evidence, by);
  }
  return verdict(
    'contradicted',
    `${user.displayName} is not on "${team}". Teamwork Graph lists: ${teams.slice(0, 10).join(', ')}.`,
    evidence,
    by
  );
}

// ---------------------------------------------------------------------------
// Exported actions: each runs its checker, then saves a receipt.
// ---------------------------------------------------------------------------

/** Who is asking, and from which Jira issue (if any). */
function invocationInfo(payload, context) {
  const accountId = context?.principal?.accountId ?? payload?.context?.accountId ?? null;
  const issueKey = payload?.context?.jira?.issueKey ?? payload?.context?.jira?.issue?.key ?? null;
  return { accountId, issueKey };
}

const withReceipt = (check, describe) => async (payload, context) => {
  const started = Date.now();
  const result = await check(payload);
  const latencyMs = Date.now() - started;
  const { accountId, issueKey } = invocationInfo(payload, context);
  // One structured line per check, so `forge logs` can be filtered and
  // summed. No claim text or evidence: logs can be shared with the vendor.
  console.log(JSON.stringify({ event: 'check', checker: result.checkedBy, verdict: result.verdict, ms: latencyMs }));
  if (!accountId) {
    console.warn('No accountId for receipt; context keys:', Object.keys(context ?? {}), Object.keys(payload?.context ?? {}));
  }
  await saveReceipt({
    accountId,
    checker: result.checkedBy,
    verdict: result.verdict,
    claim: describe(payload),
    // Link the receipt to the issue the claim is about, or the issue it was asked from.
    issueKey: result.evidence?.issueKey ?? issueKey,
    evidence: result.evidence,
    latencyMs,
  });
  return result;
};

// The raw checkers, without receipts, for the accuracy tests.
export const checkers = { jira: checkJiraClaim, doc: checkDocClaim, team: checkTeamClaim };

/**
 * Check one already-validated claim for the "Check an answer" box and save a
 * receipt, the same way the Rovo actions do.
 */
export async function checkAndRecord(kind, input, claim, accountId) {
  const started = Date.now();
  const result = await checkers[kind](input);
  const latencyMs = Date.now() - started;
  console.log(JSON.stringify({ event: 'check', via: 'page', checker: result.checkedBy, verdict: result.verdict, ms: latencyMs }));
  await saveReceipt({
    accountId,
    checker: result.checkedBy,
    verdict: result.verdict,
    claim,
    issueKey: result.evidence?.issueKey ?? null,
    evidence: result.evidence,
    latencyMs,
  });
  return { ...result, latencyMs };
}

export const verifyJiraClaim = withReceipt(
  checkJiraClaim,
  (p) => `${String(p?.issueKey ?? '').toUpperCase()} ${p?.field} is "${p?.claimedValue}"`
);
export const verifyDocClaim = withReceipt(checkDocClaim, (p) => String(p?.claim ?? ''));
export const verifyTeamClaim = withReceipt(checkTeamClaim, (p) => `${p?.person} is on ${p?.team}`);
