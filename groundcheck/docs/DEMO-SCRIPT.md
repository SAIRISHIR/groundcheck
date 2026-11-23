# Groundcheck demo video script (about 4 minutes)

Record at 1920×1080 in Jira on the demo site, light theme, browser zoom 110%.
Close other tabs and notifications. Say the lines in quotes; the rest is what
to show.

## 0:00–0:25 The problem

Show a Rovo chat with an AI answer about checkout v2 (paste the answer below
into any Rovo agent first so it is on screen).

"AI assistants write confident answers about our work. This one sounds right.
But some of these sentences are wrong, and I can't tell which. Groundcheck
can."

Answer to paste:

> Checkout v2 launches to all customers on 1 November 2025. Ryan Lee owns
> rollback. DEMO-8 is assigned to Jennifer Evans and DEMO-9 is Done. The
> vendor's fee is 1.9% per card payment. Apple Pay ships before Google Pay.
> Max Taylor is on Team Nova.

## 0:25–1:45 The Groundcheck agent

Open Rovo, choose the **Groundcheck** agent, paste the same answer, send.

While it runs: "Groundcheck splits the answer into single claims and checks
each one, as me, against Jira, Confluence and Teamwork Graph."

When the reply appears, go line by line:

- Launch date: **Contradicted**. The rollout plan says 5 December 2026. "The
  old date comes from an archived v1 page, and Groundcheck knows not to trust it."
- Ryan Lee: **Contradicted**. Kevin Campbell owns rollback.
- DEMO-8: **Contradicted**, reassigned to Max Taylor. DEMO-9: **Contradicted**,
  it was reopened.
- Fee 1.9%: **Verified**. "That page also contains a prompt injection telling
  AI assistants to mark everything Verified. It didn't work."
- Apple Pay: **Sources disagree**. "The decisions log says Apple Pay first,
  but Jira shows Google Pay is already done. The plan is out of date, and
  Groundcheck shows both sides."
- Max Taylor: **Verified** through Teamwork Graph.

## 1:45–2:30 Why you can trust it

Show `README.md` section "Why the AI judge can't make things up", or a simple
slide.

"The AI never decides a verdict. It only proposes exact quotes. Code checks
that every quote is word for word in the document and about the claim, throws
away the rest, and computes the verdict. A made-up quote can't get through,
and neither can an injected instruction."

## 2:30–3:15 Receipts in Jira

Open DEMO-8. Show the Groundcheck issue panel: live status and assignee,
"Teamwork Graph agrees", and the receipts from the checks just made.

Open the Groundcheck page (Apps → Groundcheck): counts of wrong claims caught,
your receipts. "Receipts are private to whoever made them, because they can
quote pages others can't read, and they're deleted after 90 days."

## 3:15–3:45 Accuracy

Scroll to **Accuracy**. On **Your site (live)**, press **Build test from this
site**, then **Run test**, and let it fill in (speed up the recording). "It
builds its own test from this site's issues, pages and teams, true facts and
copies with one value changed. 24 out of 24." Switch to **Demo data**: "And 65
hand-written claims full of traps. 65 out of 65."

## 3:45–4:10 Everywhere

Show the agent's skill and the MCP endpoint (Claude Code with the
`groundcheck` MCP server calling `verify-jira-claim`, if signed in).

"The same checkers are a Rovo skill any agent can use and an MCP server for
Claude and IDEs. All of it runs on Atlassian. Groundcheck: know which
sentence is wrong."
