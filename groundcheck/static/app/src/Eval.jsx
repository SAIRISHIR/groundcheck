import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@forge/bridge';
import { Ms, Pill, Skel, VERDICTS, shortTime } from './ui.jsx';

const CHECKER_NAMES = { jira: 'Jira', doc: 'Confluence + Jira', team: 'Teamwork Graph' };

// How many cases run at the same time. Each one is a separate resolver call.
const PARALLEL = 3;

/** A drawn tick or cross saying whether the checker got the case right. */
function ResultMark({ pass }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" role="img" aria-label={pass ? 'Correct' : 'Wrong'}>
      {pass ? (
        <path d="M2 6.5 4.8 9.2 10 3" fill="none" stroke="var(--verified-ink)" strokeWidth="1.6" />
      ) : (
        <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="var(--contradicted-ink)" strokeWidth="1.6" />
      )}
    </svg>
  );
}

/**
 * Accuracy, two ways:
 *  - Your site (live): a test generated from this site's own issues, pages and
 *    teams, so it works on any site, including a judge's.
 *  - Demo data: 64 claims with known answers about the demo project.
 */
export default function Eval() {
  const [mode, setMode] = useState('live');
  return (
    <section className="panel" aria-labelledby="eval-title">
      <div className="panel__head">
        <h2 className="panel__title" id="eval-title">
          Accuracy
        </h2>
        <div className="segments" role="group" aria-label="Which test">
          <button aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
            Your site (live)
          </button>
          <button aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>
            Demo data
          </button>
        </div>
      </div>
      {mode === 'live' ? <LiveTest /> : <DemoTest />}
    </section>
  );
}

// ---------------------------------------------------------------------------

function LiveTest() {
  const [set, setSet] = useState(undefined); // undefined = loading, null = none yet
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);

  // Only accept a well-formed test; anything else counts as "none yet".
  const valid = (s) => (s && Array.isArray(s.cases) ? s : null);

  useEffect(() => {
    invoke('getSelfTest')
      .then((r) => setSet(valid(r?.set)))
      .catch((e) => setError(e.message ?? String(e)));
  }, []);

  async function build() {
    setBuilding(true);
    setError(null);
    try {
      setSet(valid(await invoke('buildSelfTest')));
    } catch (e) {
      setError(e.message ?? String(e));
    }
    setBuilding(false);
  }

  if (set === undefined && !error) return <div className="panel__body"><Skel w="100%" h={120} /></div>;

  return (
    <Runner
      key={set?.at ?? 'none'}
      cases={set?.cases ?? null}
      runCase={(id) => invoke('runSelfTestCase', { id })}
      description={
        set
          ? `${set.cases.length} claims generated from this site ${shortTime(set.at)}: true facts and copies with one value changed`
          : 'Builds claims from recent issues, pages and teams you can see on this site, then checks them'
      }
      emptyText={
        set && set.cases.length === 0
          ? 'Nothing on this site to build claims from yet. Add a few issues or pages with numbers in them.'
          : null
      }
      extraAction={
        <button className={set ? 'text-button' : 'button button--secondary'} onClick={build} disabled={building}>
          {building ? 'Building…' : set ? 'New test' : 'Build test from this site'}
        </button>
      }
      error={error}
      showRun={Boolean(set && set.cases.length)}
    />
  );
}

function DemoTest() {
  const [cases, setCases] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('getEvalCases')
      .then((data) => {
        setCases(data.cases.map((c) => ({ ...c, accept: [c.expected] })));
        setLastRun(data.lastRun);
      })
      .catch((e) => setError(e.message ?? String(e)));
  }, []);

  if (!cases && !error) return <div className="panel__body"><Skel w="100%" h={120} /></div>;

  return (
    <Runner
      cases={cases}
      saved={lastRun}
      runCase={(id) => invoke('runEvalCase', { id })}
      onDone={(results) => invoke('saveEvalRun', { results }).then(setLastRun)}
      description={
        cases
          ? `${cases.length} claims with known answers about the demo project DEMO and space GCD. Traps: reassigned and reopened issues, look-alikes, an archived plan, prompt injections`
          : ''
      }
      error={error}
      showRun={Boolean(cases)}
    />
  );
}

// ---------------------------------------------------------------------------

const SHOW = {
  all: { label: 'All', test: () => true },
  fail: { label: 'Misses', test: (c, r) => r && !r.pass },
  jira: { label: 'Jira', test: (c) => c.checker === 'jira' },
  doc: { label: 'Confluence + Jira', test: (c) => c.checker === 'doc' },
  team: { label: 'Teamwork Graph', test: (c) => c.checker === 'team' },
};

/** Runs a set of cases through the real checkers and shows the score. */
function Runner({ cases, saved, runCase, onDone, description, emptyText, extraAction, error: outerError, showRun }) {
  const [results, setResults] = useState(() =>
    saved ? Object.fromEntries(saved.results.map((r) => [r.id, r])) : {}
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [show, setShow] = useState('all');

  useEffect(() => {
    if (saved) setResults(Object.fromEntries(saved.results.map((r) => [r.id, r])));
  }, [saved]);

  async function runAll() {
    setRunning(true);
    setError(null);
    setResults({});
    const done = {};
    const queue = [...cases];
    // A small pool of workers, each taking the next case until none are left.
    const worker = async () => {
      while (queue.length) {
        const next = queue.shift();
        try {
          done[next.id] = await runCase(next.id);
        } catch (e) {
          done[next.id] = { id: next.id, got: 'error', pass: false, reason: e.message ?? String(e) };
        }
        setResults({ ...done });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (onDone) {
      try {
        await onDone(Object.values(done));
      } catch (e) {
        setError(`Results not saved: ${e.message ?? e}`);
      }
    }
    setRunning(false);
  }

  const byChecker = useMemo(
    () =>
      Object.keys(CHECKER_NAMES)
        .map((checker) => {
          const mine = (cases ?? []).filter((c) => c.checker === checker);
          const done = mine.filter((c) => results[c.id]);
          return { checker, total: mine.length, done: done.length, passed: done.filter((c) => results[c.id].pass).length };
        })
        .filter((b) => b.total > 0),
    [cases, results]
  );

  const finished = (cases ?? []).filter((c) => results[c.id]);
  const passed = finished.filter((c) => results[c.id].pass).length;
  const rows = (cases ?? []).filter((c) => SHOW[show].test(c, results[c.id]));
  const shownError = outerError ?? error;

  return (
    <>
      <div className="panel__body">
        <p className="muted" style={{ marginBottom: 14 }}>
          {description}
        </p>
        <div className="grid">
          <div className="span-4">
            <div className="lead__label">Correct verdicts</div>
            <div className="lead__figure">
              {finished.length ? (
                <>
                  {passed}
                  <span className="unit" style={{ fontSize: 20 }}>
                    {' '}
                    / {cases.length}
                  </span>
                </>
              ) : (
                <span className="dash">—</span>
              )}
            </div>
            <div className="lead__sub">
              {running
                ? `Running ${finished.length} of ${cases.length}…`
                : saved
                ? `Last run ${shortTime(saved.at)} · as you, no receipts saved`
                : finished.length
                ? 'As you, no receipts saved'
                : 'Not run yet'}
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              {showRun && (
                <button className="button button--secondary" onClick={runAll} disabled={running}>
                  {running ? 'Running…' : finished.length ? 'Run again' : 'Run test'}
                </button>
              )}
              {extraAction}
            </div>
          </div>

          <div className="span-8">
            {byChecker.length > 0 && (
              <div className="bars" aria-label="Correct verdicts per checker">
                {byChecker.map((b) => {
                  const fail = b.done - b.passed;
                  return (
                    <div className="bar-row" key={b.checker}>
                      <span className="muted">{CHECKER_NAMES[b.checker]}</span>
                      <div className="bar-row__track" role="img" aria-label={`${b.passed} of ${b.total} correct`}>
                        <div className="bar-row__pass" style={{ width: `${(100 * b.passed) / b.total}%` }} />
                        {fail > 0 && <div className="bar-row__fail" style={{ width: `${(100 * fail) / b.total}%` }} />}
                      </div>
                      <span className="num bar-row__value">
                        {b.passed}/{b.total}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {emptyText && <div className="empty" style={{ marginTop: 14 }}>{emptyText}</div>}
        {shownError && (
          <div className="error-line" style={{ marginTop: 12 }}>
            {shownError}
          </div>
        )}
      </div>

      {cases && cases.length > 0 && (
        <>
          <div className="panel__head" style={{ paddingTop: 0, paddingBottom: 8 }}>
            <div className="segments" role="group" aria-label="Filter cases">
              {Object.entries(SHOW).map(([key, s]) => (
                <button key={key} aria-pressed={show === key} onClick={() => setShow(key)}>
                  {s.label} <span className="num">{cases.filter((c) => s.test(c, results[c.id])).length}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="scroll">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Claim</th>
                  <th>Expected</th>
                  <th>Got</th>
                  <th className="r hide-phone">Took</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      {show === 'fail' ? 'No misses.' : 'No cases.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((c) => {
                    const r = results[c.id];
                    const sub = r && !r.pass && r.reason ? r.reason : c.note;
                    return (
                      <tr key={c.id}>
                        <td className="num faint">{c.id}</td>
                        <td className="claim">
                          <span className="claim__text" title={c.claim}>
                            {c.claim}
                          </span>
                          {sub && (
                            <span className="claim__text faint small" title={sub}>
                              {sub}
                            </span>
                          )}
                        </td>
                        <td>
                          <Pill verdict={c.accept[0]} />
                          {c.accept.length > 1 && (
                            <span className="claim__text faint small">
                              or {c.accept.slice(1).map((v) => VERDICTS[v]?.label.toLowerCase() ?? v).join(', ')}
                            </span>
                          )}
                        </td>
                        <td>
                          {r ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <Pill verdict={r.got} />
                              <ResultMark pass={r.pass} />
                            </span>
                          ) : (
                            <span className="dash">—</span>
                          )}
                        </td>
                        <td className="r hide-phone">{r ? <Ms value={r.ms ?? null} /> : <span className="dash">—</span>}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
