/**
 * Groundcheck: reading Confluence as the user.
 *
 * Every request uses api.asUser(), so a claim can only ever be checked
 * against pages the person asking is allowed to read.
 */
import api, { route } from '@forge/api';
import { keywords, topicWords, rankHits, storageToText } from './text.js';

/** Make a string safe to place inside a quoted CQL value. */
const cqlSafe = (s) => String(s ?? '').replace(/["\\]/g, ' ').slice(0, 200);

/**
 * Find the pages most likely to mention the claim.
 * @returns {Promise<Array<{id: string, title: string}>>}
 */
export async function searchPages(claim, pageTitle, limit = 3) {
  if (pageTitle) {
    return runCql(`type = page AND title ~ "${cqlSafe(pageTitle)}"`, limit);
  }
  const topic = topicWords(claim);
  const all = keywords(claim);
  if (all.length === 0) return [];

  // A multi-word text search only matches pages containing EVERY word. So we
  // try, in order, until we have enough pages:
  //   1. all the topic words (what the claim is about, without its values),
  //   2. Confluence's own ranked search (CQL siteSearch, the engine behind
  //      the search bar), which does not need every word to match. This finds
  //      the page when the claim is worded differently from it, for example
  //      "the system rolls back" against "we roll back",
  //   3. the topic words with one word left out, for each word in turn. A
  //      wrong name in the claim ("Adyen is the payment processor") is a
  //      topic word that the right page doesn't contain, so leaving it out
  //      finds the page that contradicts it,
  //   4. every word in the claim,
  //   5. any topic word, re-ranked by how many topic words each hit contains.
  const found = [];
  const add = (hits) => {
    for (const h of hits) if (!found.some((f) => f.id === h.id)) found.push(h);
  };
  const strict = (words) => runCql(`type = page AND text ~ "${cqlSafe(words.join(' '))}"`, limit);
  if (topic.length >= 2) add(await strict(topic));
  if (found.length < limit && topic.length >= 2) {
    // Ranked search can return loosely related pages, so take at most two:
    // the strict searches below still get a chance to fill the last slot.
    add((await runCql(`type = page AND siteSearch ~ "${cqlSafe(topic.join(' '))}"`, limit)).slice(0, 2));
  }
  if (found.length < limit && topic.length >= 3) {
    const leaveOneOut = await Promise.all(topic.map((_, i) => strict(topic.filter((__, j) => j !== i))));
    // Pages found by more of these searches come first.
    const counts = new Map();
    for (const hits of leaveOneOut) {
      for (const h of hits) counts.set(h.id, { hit: h, n: (counts.get(h.id)?.n ?? 0) + 1 });
    }
    add([...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.hit));
  }
  if (found.length < limit) add(await strict(all));
  if (found.length < limit) {
    const words = topic.length ? topic : all;
    const anyWord = words.map((w) => `text ~ "${cqlSafe(w)}"`).join(' OR ');
    add(rankHits(await runCql(`type = page AND (${anyWord})`, 10), words));
  }
  return found.slice(0, limit);
}

/** Run one CQL search as the user. */
async function runCql(cql, limit) {
  const res = await api.asUser().requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=${limit}`);
  if (!res.ok) {
    console.error(`Confluence search returned ${res.status}`);
    return [];
  }
  const body = await res.json();
  return (body.results ?? [])
    .filter((r) => r?.content?.id)
    .map((r) => ({
      id: String(r.content.id),
      title: r.content.title ?? r.title ?? 'Untitled',
      // Search excerpts carry @@@hl@@@ highlight markers; strip them.
      excerpt: String(r.excerpt ?? '').replace(/@@@(end)?hl@@@/g, ''),
    }));
}

/**
 * Read one page's text and metadata.
 * @returns {Promise<null | {id, title, text, url, lastUpdated}>}
 */
export async function readPage(id, maxChars = 6000) {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=storage`);
  if (!res.ok) return null;
  const page = await res.json();
  return {
    id: String(page.id),
    title: page.title,
    text: storageToText(page.body?.storage?.value).slice(0, maxChars),
    url: page._links?.webui ? `/wiki${page._links.webui}` : null,
    lastUpdated: page.version?.createdAt ?? null,
  };
}
