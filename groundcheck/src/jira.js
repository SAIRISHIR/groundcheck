/**
 * Groundcheck: finding Jira issues related to a free-text claim.
 *
 * The document checker uses this so a claim is compared with BOTH what the
 * plans say (Confluence) and what is actually happening (Jira). When the two
 * disagree, Groundcheck reports a conflict instead of trusting either one.
 *
 * Requests run as the user, so only issues they can see are ever used.
 */
import api, { route } from '@forge/api';
import { topicWords, relatedIssues, jiraRecordText } from './text.js';

/**
 * Find up to `max` Jira issues whose summary is about the claim's topic.
 * @returns {Promise<Array<{id: string, kind: 'jira', title: string, text: string, url: string, issueKey: string}>>}
 */
export async function searchRelatedIssues(claim, max = 3) {
  // Only letters and digits go into JQL, so nothing in the claim can change
  // the shape of the query.
  const words = topicWords(claim, 6)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length > 2);
  if (words.length === 0) return [];

  const jql = `${words.map((w) => `summary ~ "${w}"`).join(' OR ')} ORDER BY updated DESC`;
  const res = await api
    .asUser()
    .requestJira(
      route`/rest/api/3/search/jql?jql=${jql}&fields=summary,status,assignee,issuetype,duedate&maxResults=20`
    );
  if (!res.ok) {
    // A failed Jira search must not break the Confluence check.
    console.warn(`Jira search returned ${res.status}`);
    return [];
  }
  const body = await res.json();

  return relatedIssues(body.issues ?? [], words, max).map((issue) => ({
    id: `jira:${issue.key}`,
    kind: 'jira',
    issueKey: issue.key,
    title: `${issue.key} (Jira issue)`,
    text: jiraRecordText(issue),
    url: `/browse/${issue.key}`,
  }));
}
