import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@forge/bridge';
import {
  CHECKERS,
  Evidence,
  Mark,
  Ms,
  Pill,
  RefreshIcon,
  Skel,
  Swatch,
  VERDICTS,
  VERDICT_ORDER,
  evidenceSummary,
  openLink,
  pct,
  shortTime,
  timeAgo,
} from './ui.jsx';
import { Composition, DailyVerdicts } from './charts.jsx';
import Eval from './Eval.jsx';
import CheckAnswer from './CheckAnswer.jsx';

/**
 * Groundcheck overview (a Jira global page).
 *
 * The screen's one question: how often are the AI answers people check wrong,
 * and which claims? The lead figure answers it; everything below is evidence.
 *
 * Site-wide blocks are counts only. The receipts are the current user's own,
 * because a receipt can quote a page only its author may read.
 */
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    // The dashboard and the source probes load independently: a slow source
    // must not hold back the numbers.
    invoke('getDashboard')
      .then(setData)
      .catch((e) => setError(e.message ?? String(e)))
      .finally(() => setLoading(false));
    invoke('getSystemStatus')
      .then(setStatus)
      .catch(() => setStatus({ failed: true }));
  }, []);

  useEffect(load, [load]);

  const totals = useMemo(() => {
    const t = Object.fromEntries(VERDICT_ORDER.map((v) => [v, 0]));
    for (const c of data?.counts ?? []) if (c.verdict in t) t[c.verdict] += c.count;
    return t;
  }, [data]);
  const checked = VERDICT_ORDER.reduce((s, v) => s + totals[v], 0);
  const wrong = totals.contradicted + totals.conflict;

  return (
    <div className="term">
      <TermBar status={status} onRefresh={load} loading={loading} at={data?.at} />
      <main className="canvas">
        <div className="title-row">
          <div>
            <h1>Claim ledger</h1>
            <p>{data ? finding(totals, checked, data.sources) : <Skel w={360} h={14} />}</p>
          </div>
        </div>

        {error ? (
          <section className="panel panel__body">
            <div className="error-line">
              Couldn’t load the ledger: {error}.{' '}
              <button className="text-button" onClick={load}>
                Retry
              </button>
            </div>
          </section>
        ) : (
          <>
            <Lead data={data} totals={totals} checked={checked} wrong={wrong} />
            <CheckAnswer onChecked={load} />
            <div className="grid">
              <section className="panel span-8 stretch" aria-labelledby="daily-title">
                <div className="panel__head">
                  <h2 className="panel__title" id="daily-title">
                    Verdicts per day
                  </h2>
                  <Legend />
                  <span className="panel__meta">Last 14 days · whole site</span>
                </div>
                <div className="panel__body">
                  {data ? <DailyVerdicts days={data.timeline} /> : <Skel w="100%" h={190} />}
                </div>
              </section>
              <Sources data={data} />
            </div>
            <Receipts data={data} />
          </>
        )}

        <Eval />
      </main>
    </div>
  );
}

/** The screen's finding, in one sentence built from the same numbers as the lead. */
function finding(totals, checked, sources) {
  if (checked === 0) return 'No claims checked in the last 30 days. Ask the Groundcheck agent in Rovo to check an answer.';
  const wrong = totals.contradicted + totals.conflict;
  const worst = [...(sources ?? [])].sort((a, b) => b.wrong - a.wrong)[0];
  const where = worst && worst.wrong > 0 ? `, most often in ${CHECKERS[worst.checker] ?? worst.checker} claims` : '';
  return `${wrong} of ${checked} claims checked in the last 30 days were wrong or disputed${where}.`;
}

// ---------------------------------------------------------------------------

function TermBar({ status, onRefresh, loading, at }) {
  const items = [
    ['jira', 'Jira'],
    ['confluence', 'Confluence'],
    ['graph', 'Teamwork Graph'],
    ['ai', 'AI judge'],
  ];
  return (
    <header className="term-bar">
      <div className="brand">
        <Mark />
        <span className="brand__name">Groundcheck</span>
        <span className="brand__scope">Fact-checks AI answers against Jira, Confluence and Teamwork Graph</span>
      </div>
      {/* On narrow screens the four sources fold into one summary. */}
      <span className="status-summary">
        <span className={`dot${!status ? '' : allUp(status) ? ' dot--ok' : ' dot--down'}`} aria-hidden="true" />
        {!status ? 'Checking sources' : allUp(status) ? 'All sources online' : `${downCount(status)} source(s) down`}
      </span>
      <div className="status-line" aria-label="Source status">
        {items.map(([key, label]) => {
          const s = status?.[key];
          const state = !status ? '' : status.failed || !s?.ok ? ' dot--down' : ' dot--ok';
          return (
            <span className="status-item" key={key} title={s?.detail ?? undefined}>
              <span className={`dot${state}`} aria-hidden="true" />
              <span className="status-item__label">
                {key === 'ai' && s?.detail ? modelName(s.detail) : label}
              </span>
              <span className="status-item__ms">{s ? <Ms value={s.ms} /> : <Skel w={36} h={10} />}</span>
            </span>
          );
        })}
        <span className="stamp">{at ? `Updated ${shortTime(at)}` : ''}</span>
      </div>
      <button className="icon-button" onClick={onRefresh} aria-label="Refresh" aria-busy={loading} title="Refresh">
        <RefreshIcon />
      </button>
    </header>
  );
}

const SOURCE_KEYS = ['jira', 'confluence', 'graph', 'ai'];
const downCount = (status) => (status.failed ? SOURCE_KEYS.length : SOURCE_KEYS.filter((k) => !status[k]?.ok).length);
const allUp = (status) => downCount(status) === 0;

/** "claude-haiku-4-5-20251001" -> "AI judge · Haiku 4.5". */
function modelName(id) {
  const m = /claude-(\w+)-(\d+)-(\d+)/.exec(id ?? '');
  return m ? `AI judge · ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : 'AI judge';
}

function Legend() {
  return (
    <span className="legend">
      {['verified', 'contradicted', 'conflict', 'not_recorded'].map((v) => (
        <span className="legend__item" key={v}>
          <Swatch verdict={v} />
          {VERDICTS[v].label}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------

function Lead({ data, totals, checked, wrong }) {
  const cells = [
    { key: 'verified' },
    { key: 'contradicted' },
    { key: 'conflict' },
    { key: 'not_recorded' },
  ];
  return (
    <section className="panel lead" aria-label="Last 30 days, whole site">
      <div className="lead__answer">
        <div className="lead__label">Wrong or disputed</div>
        <div className="lead__figure lead__figure--accent">{data ? pct(wrong, checked) : <Skel w={140} h={34} />}</div>
        <div className="lead__sub">
          {data ? (
            <>
              <span className="num">{wrong}</span> of <span className="num">{checked}</span> claims · last 30 days
            </>
          ) : (
            <Skel w={180} />
          )}
        </div>
      </div>
      <div className="lead__strip">
        <div className="kpis">
          <div className="kpi">
            <div className="kpi__label">Claims checked</div>
            <div className="kpi__value">{data ? checked : <Skel w={40} h={20} />}</div>
            <div className="kpi__sub kpi__sub--text">whole site</div>
          </div>
          {cells.map(({ key }) => (
            <div className="kpi" key={key}>
              <div className="kpi__label">
                <Swatch verdict={key} />
                {VERDICTS[key].label}
              </div>
              <div className="kpi__value">{data ? totals[key] : <Skel w={40} h={20} />}</div>
              <div className="kpi__sub">{data ? pct(totals[key], checked) : ''}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'auto' }}>{data ? <Composition totals={totals} /> : null}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Sources({ data }) {
  // Every checker gets a row, with honest zeros when it has not run.
  const rows = Object.keys(CHECKERS).map(
    (checker) => data?.sources?.find((s) => s.checker === checker) ?? { checker, total: 0, wrong: 0, avgMs: null }
  );
  const usage = data?.usage;
  return (
    <section className="panel span-4 stretch" aria-labelledby="sources-title" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="panel__head">
        <h2 className="panel__title" id="sources-title">
          Sources
        </h2>
        <span className="panel__meta">Last 30 days</span>
      </div>
      <div style={{ paddingTop: 6 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Checker</th>
              <th className="r">Checks</th>
              <th className="r">Caught</th>
              <th className="r">Avg time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.checker}>
                <td>{CHECKERS[r.checker]}</td>
                <td className="r num">{data ? r.total : <Skel w={20} />}</td>
                <td className="r num">{data ? r.wrong : <Skel w={20} />}</td>
                <td className="r">{data ? <Ms value={r.avgMs} /> : <Skel w={40} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel__body" style={{ marginTop: 'auto' }}>
        <div className="meter" aria-label="AI judge calls today">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">AI judge calls today</span>
            <span className="num">{usage ? `${usage.used} / ${usage.cap}` : <Skel w={50} />}</span>
          </div>
          <div className="meter__track">
            <div className="meter__fill" style={{ width: usage ? `${Math.min(100, (100 * usage.used) / usage.cap)}%` : 0 }} />
          </div>
          <div className="meter__ends">
            <span className="num">0</span>
            <span>
              Daily cap <span className="num">{usage?.cap ?? ''}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

const FILTERS = {
  all: { label: 'All', test: () => true },
  wrong: { label: 'Wrong or disputed', test: (r) => r.verdict === 'contradicted' || r.verdict === 'conflict' },
  verified: { label: 'Verified', test: (r) => r.verdict === 'verified' },
  open: { label: 'Not recorded', test: (r) => r.verdict === 'not_recorded' || r.verdict === 'not_checked' },
};
const CAP = 8;

function Receipts({ data }) {
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const mine = data?.mine ?? [];
  const visible = mine.filter(FILTERS[filter].test);
  const rows = showAll ? visible : visible.slice(0, CAP);
  const tape = [...mine].reverse(); // oldest on the left, newest on the right

  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));
  const openFromTape = (r) => {
    setFilter('all');
    const index = mine.findIndex((m) => m.id === r.id);
    if (index >= CAP) setShowAll(true);
    setOpenId(r.id);
  };

  return (
    <section className="panel" aria-labelledby="receipts-title">
      <div className="panel__head">
        <h2 className="panel__title" id="receipts-title">
          Your receipts
        </h2>
        <div className="segments" role="group" aria-label="Filter receipts">
          {Object.entries(FILTERS).map(([key, f]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => {
                setFilter(key);
                setShowAll(false);
              }}
            >
              {f.label} <span className="num">{mine.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <span className="panel__meta">Private to you · kept {data?.retentionDays ?? 90} days</span>
      </div>

      <div className="panel__body" style={{ paddingBottom: 6 }}>
        {data && mine.length > 0 ? (
          <div className="tape" role="group" aria-label="Your checks in order, newest on the right">
            {tape.map((r) => {
              const mark = VERDICTS[r.verdict]?.mark;
              return (
                <button
                  key={r.id}
                  className={`tape__mark${mark ? '' : ' tape__mark--outline'}${openId === r.id ? ' is-active' : ''}`}
                  style={{ background: mark ?? undefined }}
                  title={`${VERDICTS[r.verdict]?.label ?? r.verdict}: ${r.claim}`}
                  aria-label={`${VERDICTS[r.verdict]?.label ?? r.verdict}: ${r.claim}`}
                  onClick={() => openFromTape(r)}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      {!data ? (
        <div className="panel__body">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: 42, display: 'flex', alignItems: 'center', gap: 16 }}>
              <Skel w={40} />
              <Skel w={90} h={20} />
              <Skel w="40%" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="panel__body">
          <div className="empty">
            {mine.length === 0
              ? 'You haven’t checked anything yet. In Rovo, choose the Groundcheck agent and paste an AI answer.'
              : 'No receipts match this filter.'}
          </div>
        </div>
      ) : (
        <>
          <table className="table table--stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Verdict</th>
                <th>Claim</th>
                <th className="hide-phone">Checked in</th>
                <th className="hide-phone">Evidence</th>
                <th className="r">Took</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <ReceiptRow key={r.id} r={r} open={openId === r.id} onToggle={() => toggle(r.id)} />
              ))}
            </tbody>
          </table>
          {visible.length > CAP && (
            <div className="panel__foot">
              <span className="num">
                {rows.length} of {visible.length}
              </span>
              <button className="text-button" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `Show all ${visible.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ReceiptRow({ r, open, onToggle }) {
  const summary = evidenceSummary(r.evidence);
  return (
    <>
      <tr
        className={`is-clickable${open ? ' is-open' : ''}`}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())}
        tabIndex={0}
        aria-expanded={open}
      >
        <td className="num faint" title={timeAgo(r.createdAt)}>
          {shortTime(r.createdAt)}
        </td>
        <td>
          <Pill verdict={r.verdict} />
        </td>
        <td className="claim">
          <span className="claim__text" title={r.claim}>
            {r.claim}
          </span>
        </td>
        <td className="hide-phone muted nowrap">{CHECKERS[r.checker] ?? r.checker}</td>
        <td className="hide-phone muted" style={{ maxWidth: 0, width: '22%' }}>
          <span className="claim__text">{summary ?? <span className="dash">—</span>}</span>
        </td>
        <td className="r">
          <Ms value={r.latencyMs} />
        </td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={6}>
            <Evidence evidence={r.evidence} />
            {r.issueKey && (
              <p className="reason small">
                Asked about{' '}
                <a className="mono" href={`/browse/${r.issueKey}`} onClick={(e) => openLink(e, `/browse/${r.issueKey}`)}>
                  {r.issueKey}
                </a>{' '}
                · {timeAgo(r.createdAt)} · {CHECKERS[r.checker] ?? r.checker}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
