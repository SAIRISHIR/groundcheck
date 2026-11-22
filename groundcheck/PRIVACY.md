# Groundcheck privacy policy

Last updated: 22 November 2026

Groundcheck is a Forge app that runs entirely on the Atlassian platform
("Runs on Atlassian"). It does not send data to any service outside Atlassian.

## What Groundcheck reads

When someone asks Groundcheck to check a claim, it reads, **as that person and
only with their permissions**:

- the Jira issue fields named in the claim (status, assignee, summary),
- Confluence pages that match the claim,
- for claims about documents, up to three Jira issues whose summary matches
  the claim's topic (key, summary, type, status, assignee and due date only;
  never descriptions or comments),
- Teamwork Graph team memberships for the person named in the claim.

Groundcheck never writes to Jira, Confluence or Teamwork Graph.

## AI processing

Claims about Confluence content are judged by a Claude model provided through
Atlassian's Forge LLMs service. Text pasted into *Check an answer* is also
sent to that model once, to split it into separate claims. The claim, the text of up to three matching
pages and the fields listed above for up to three related Jira issues are sent
to that model for that one request. Forge LLMs is hosted by
Atlassian, and the request is subject to Atlassian's AI moderation.

## What Groundcheck stores

For each checked claim, Groundcheck stores a receipt in the app's Forge SQL
database on Atlassian's platform:

- the account ID of the person who asked,
- the claim text, the verdict and which checker produced it,
- the evidence: an issue key and field value, a short quote and page link, or
  a list of team names,
- a timestamp.

Receipts are shown only to the person who created them. Site-wide statistics
are shown as counts only. **Receipts are deleted automatically after 90 days.**

Groundcheck also stores a daily count of AI calls (no content) to enforce a
usage limit, and the result of the latest accuracy eval run (case ids,
verdicts and pass or fail; no evidence text).

Each user's latest live self-test (claims generated from issues, pages and
teams they can see) is stored for that user only, and replaced when they build
a new one.

## Removing data

Every day Groundcheck reports the account IDs it stores to Atlassian's
personal data reporting API, and deletes all receipts of accounts that have
been closed.

## Contact

Groundcheck is built by SAI RISHI R (independent developer). For questions or
data requests, email sairishir.yt@gmail.com.

Uninstalling Groundcheck deletes its stored data under Atlassian's Forge data
retention rules. To request earlier deletion of your receipts, email the
developer (see Contact below).
