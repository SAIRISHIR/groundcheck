import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import { CHECKERS, Evidence, Mark, Ms, Pill, Skel, shortTime, timeAgo } from './ui.jsx';

/**
 * Groundcheck issue panel.
 *
 * Its question: what is actually recorded on this issue right now, and what
 * have I checked about it? Top: the live record, with whether Teamwork Graph
 * agrees on the assignee. Below: the claims YOU have checked about this issue.
 */
export default function IssuePanel() {
  const [facts, setFacts] = useState(null);
  const [receipts, setReceipts] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);

  const load = () => {
    setError(null);
    invoke('getIssueFacts')
      .then(setFacts)
      .catch((e) => setError(e.message ?? String(e)));
    invoke('getIssueReceipts')
      .then((rows) => {
        setReceipts(rows);
        setOpenId(rows[0]?.id ?? null); // the newest check opens by default
      })
      .catch(() => setReceipts([]));
  };
  useEffect(load, []);

  const wrong = (receipts ?? []).filter((r) => r.verdict === 'contradicted' || r.verdict === 'conflict').length;

  return (
    <div className="issue">
      <div className="issue__head">
        <Mark size={18} />
        <span className="brand__name">Groundcheck</span>
        <span className="issue__key">{facts?.key ?? ''}</span>
        <span className="stamp" style={{ marginLeft: 'auto' }}>
          {facts?.updated ? `Updated ${timeAgo(facts.updated)}` : ''}
        </span>
      </div>

      <h1 className="issue__summary">{facts ? facts.summary ?? facts.key : <Skel w={240} h={16} />}</h1>

      {error ? (
        <div className="error-line">
          Couldn’t read this issue: {error}.{' '}
          <button className="text-button" onClick={load}>
            Retry
          </button>
        </div>
      ) : (
        <section aria-labelledby="live-title">
          <div className="section-head">
            <h2 id="live-title">Live record</h2>
            <span className="faint small">what Jira says now</span>
          </div>
          <dl className="kv">
            <dt>Status</dt>
            <dd>{facts ? <StatusValue facts={facts} /> : <Skel w={90} />}</dd>
            <dt>Assignee</dt>
            <dd>
              {facts ? (
                facts.assignee ?? <span className="muted">Unassigned</span>
              ) : (
                <Skel w={110} />
              )}
            </dd>
            <dt>Teamwork Graph</dt>
            <dd>{facts ? <GraphAgreement facts={facts} /> : <Skel w={130} />}</dd>
            <dt>Priority</dt>
            <dd>{facts ? facts.priority ?? <span className="dash">—</span> : <Skel w={60} />}</dd>
            <dt>Due</dt>
            <dd>{facts ? <Due date={facts.dueDate} done={facts.statusCategory === 'done'} /> : <Skel w={80} />}</dd>
          </dl>
        </section>
      )}

      <section aria-labelledby="checks-title">
        <div className="section-head">
          <h2 id="checks-title">Your checks</h2>
          {receipts && receipts.length > 0 && (
            <span className="faint small">
              <span className="num">{receipts.length}</span> on this issue ·{' '}
              <span className="num">{wrong}</span> wrong or disputed
            </span>
          )}
        </div>
        {receipts === null ? (
          <Skel w="100%" h={40} />
        ) : receipts.length === 0 ? (
          <div className="empty">
            No checks yet. In Rovo, choose the Groundcheck agent and paste any answer about {facts?.key ?? 'this issue'}.
          </div>
        ) : (
          <ul className="checks">
            {receipts.map((r) => {
              const open = openId === r.id;
              return (
                <li className="check" key={r.id}>
                  <button
                    className="check__head text-button"
                    style={{ width: '100%', color: 'inherit' }}
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : r.id)}
                  >
                    <Pill verdict={r.verdict} />
                    <span className="faint small">{CHECKERS[r.checker] ?? r.checker}</span>
                    <span className="check__time num">
                      {shortTime(r.createdAt)} · <Ms value={r.latencyMs} />
                    </span>
                  </button>
                  <p className="check__claim">{r.claim}</p>
                  {open && <Evidence evidence={r.evidence} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The status with a dot for its category: grey to do, a white ring in
 * progress, green done. (Blue is kept for "Sources disagree".)
 */
function StatusValue({ facts }) {
  const style =
    facts.statusCategory === 'done'
      ? { background: 'var(--verified)' }
      : facts.statusCategory === 'indeterminate'
      ? { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--text)' } // taste-skill-ignore: a ring, not a shadow
      : { background: 'var(--unrecorded)' };
  return (
    <>
      <span className="dot" style={style} aria-hidden="true" />
      {facts.status ?? <span className="dash">—</span>}
    </>
  );
}

/** A due date, flagged when it has passed and the work is not done. */
function Due({ date, done }) {
  if (!date) return <span className="dash">—</span>;
  // Whole days between the due date and today, in local calendar days.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = date.split('-').map(Number);
  const days = Math.round((today.getTime() - new Date(y, m - 1, d).getTime()) / 86400000);
  return (
    <>
      <span className="num">{date}</span>
      {!done && days > 0 && <span className="pill pill--contradicted pill--plain">{days} d overdue</span>}
      {!done && days === 0 && <span className="pill pill--warning pill--plain">Due today</span>}
    </>
  );
}

/** Does Teamwork Graph show the same assignee as Jira? */
function GraphAgreement({ facts }) {
  if (!facts.graphOk) return <span className="muted">Not available</span>;
  const inGraph = facts.graphAssignees ?? [];
  if (!facts.assignee && inGraph.length === 0) return <span className="muted">Agrees · no assignee</span>;
  const agrees = inGraph.includes(facts.assignee);
  return agrees ? (
    <span className="pill pill--verified">Agrees</span>
  ) : (
    <span className="pill pill--conflict" title="Teamwork Graph shows a different assignee">
      Shows {inGraph.join(', ') || 'no assignee'}
    </span>
  );
}
