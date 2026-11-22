/**
 * Groundcheck: Teamwork Graph helpers.
 *
 * Teamwork Graph links people, teams, Jira work items and Confluence pages
 * across the whole site. New Forge apps can't send raw Cypher, so we register
 * "persisted queries" once and then run them by their key. To register,
 * POST { appId, name, cypher, paramsSchema } to
 * https://<site>.atlassian.net/gateway/api/twg/cypher-queries as an app
 * contributor; the response contains the queryKey to paste below.
 *
 * Every call runs AS THE USER, so results are filtered by what they may see.
 * If the app is missing a graph scope, Teamwork Graph does not raise an
 * error: it silently returns fewer rows. Keep the scopes in manifest.yml in
 * sync with the node types these queries touch.
 */
import api from '@forge/api';

// Keys returned when the queries were registered. Queries are immutable:
// changing the Cypher text means registering again and updating the key.
export const GRAPH_QUERIES = {
  // MATCH (user:AtlassianUser {ari: $userId})
  //   -[:atlassian_user_is_in_atlassian_team]->(team:AtlassianTeam) RETURN team
  userTeams: '657655bd-126d-45d3-9064-77671a8e0782',
  // MATCH (user:AtlassianUser)-[:atlassian_user_assigned_jira_work_item]->
  //   (item:JiraWorkItem {ari: $itemId}) RETURN user
  workItemAssignee: '5f8bf400-2166-485a-9cce-f5311117103d',
};

// GraphQL wrapper that executes a persisted Cypher query by key.
// The gateway requires an operation name shaped "<company>_<operation>".
const OPERATION_NAME = 'groundcheck_runPersistedQuery';
const CUSTOM_QUERY = `
  query groundcheck_runPersistedQuery($queryKey: String!, $queryParams: CypherRequestParams) {
    customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
      edges {
        node {
          columns {
            key
            value {
              __typename
              ... on CypherQueryResultNode {
                id
                # "data" is a union over every graph node type, so we ask for
                # the fields we need from each type our queries can return.
                data {
                  __typename
                  ... on AtlassianUser { accountId name }
                  ... on AtlassianTeam { id displayName }
                  ... on JiraWorkItem { key summary webUrl }
                  ... on ConfluencePage { pageId title webUrl lastUpdatedAt }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Build the ARI (Atlassian Resource Identifier) for a user account. */
export const userAri = (accountId) => `ari:cloud:identity::user/${accountId}`;

/** Build the ARI for a Jira work item (issue) on a given site. */
export const workItemAri = (cloudId, issueId) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;

/**
 * Run a persisted query and return the graph nodes it found.
 *
 * @param {string} queryKey  One of GRAPH_QUERIES.
 * @param {object} params    Query parameters, named without the leading $.
 * @returns {Promise<{nodes: Array<{column: string, id: string, data: object}>, errors: Array}>}
 */
export async function runGraphQuery(queryKey, params) {
  const res = await api
    .asUser()
    .requestTeamworkGraph(CUSTOM_QUERY, { queryKey, queryParams: params }, OPERATION_NAME);

  if (!res.ok) {
    return { nodes: [], errors: [{ message: `Teamwork Graph returned HTTP ${res.status}` }] };
  }

  // Errors come back with HTTP 200, inside the GraphQL "errors" array.
  const body = await res.json();
  const edges = body?.data?.customQuery?.edges ?? [];
  const nodes = [];
  for (const edge of edges) {
    for (const col of edge?.node?.columns ?? []) {
      if (col?.value?.__typename === 'CypherQueryResultNode') {
        nodes.push({ column: col.key, id: col.value.id, data: col.value.data ?? {} });
      }
    }
  }
  return { nodes, errors: body?.errors ?? [] };
}

/** Pick a readable name from a graph node's data, whatever shape it has. */
// (AtlassianUser has `name`, AtlassianTeam has `displayName`.)
export function nodeName(node) {
  const d = node?.data ?? {};
  return d.displayName ?? d.name ?? d.title ?? d.key ?? null;
}
