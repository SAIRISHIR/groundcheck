import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { CHECKERS, Evidence, Ms, Pill, Skel } from './ui.jsx';

// The sample answer from the demo script. Its claims are about the demo data,
// so on another site most of them come back "not recorded", which is correct.
const EXAMPLE =
  'Checkout v2 launches to all customers on 1 November 2025. Ryan Lee owns rollback. ' +
  'DEMO-8 is assigned to Jennifer Evans and DEMO-9 is Done. The vendor’s fee is 1.9% per card payment. ' +
  'Apple Pay ships before Google Pay. Max Taylor is on Team Nova.';

const PARALLEL = 3;

/**
 * Paste any AI answer and check it claim by claim, without opening Rovo.
 * Step 1 splits the text into claims (one AI call); step 2 checks each claim
 * with its own call, so results appear as they arrive.
 */
export default function CheckAnswer({ onChecked }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | splitting | checking | done
  const [claims, setClaims] = useState([]);
  const [results, setResults] = useState({});
  const [error, setError] = useState(null);

  async function check() {
    setError(null);
    setClaims([]);
    setResults({});
    setPhase('splitting');
    let split;
    try {
      split = await invoke('extractClaims', { text });
    } catch (e) {
      split = { ok: false, reason: e.message ?? String(e) };
    }
    if (!split.ok) {
      setError(split.reason);
      setPhase('idle');
      return;
    }
    setClaims(split.claims);
    setPhase('checking');

    const done = {};
    const queue = split.claims.map((c, i) => ({ ...c, i }));
    const worker = async () => {
      while (queue.length) {
        const next = queue.shift();
        try {
          done[next.i] = await invoke('checkClaim', { claim: { checker: next.checker, input: next.input } });
        } catch (e) {
          done[next.i] = { verdict: 'error', reason: e.message ?? String(e) };
        }
        setResults({ ...done });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    setPhase('done');
    onChecked?.();
  }

  const verdicts = Object.values(results).map((r) => r.verdict);
  const count = (...v) => verdicts.filter((x) => v.includes(x)).length;
  const busy = phase === 'splitting' || phase === 'checking';

  return (
    <section className="panel" aria-labelledby="check-title">
      <div className="panel__head">
        <h2 className="panel__title" id="check-title">
          Check an answer
        </h2>
        <span className="panel__meta">Checked as you · each claim gets a receipt</span>
      </div>
      <div className="panel__body">
        <label className="field-label" htmlFor="answer">
          Paste an AI answer, a status update or any text with facts in it
        </label>
        <textarea
          id="answer"
          className="textarea"
          rows={4}
          maxLength={3000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && !busy && check()}
        />
        <div className="composer-bar">
          <button className="button" onClick={check} disabled={busy || text.trim().length < 5}>
            {phase === 'splitting' ? 'Finding claims…' : phase === 'checking' ? 'Checking…' : 'Check'}
          </button>
          <button className="text-button" onClick={() => setText(EXAMPLE)} disabled={busy}>
            Use the demo example
          </button>
          <span className="faint small num" style={{ marginLeft: 'auto' }}>
            {text.length} / 3000
          </span>
        </div>
        {error && (
          <div className="error-line" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      {claims.length > 0 && (
        <>
          <div className="panel__foot" style={{ borderTop: 0, paddingTop: 0 }}>
            {phase === 'done' ? (
              <span>
                <span className="num">{count('verified')}</span> of <span className="num">{claims.length}</span> claims
                verified · <span className="num">{count('contradicted', 'conflict')}</span> wrong or disputed ·{' '}
                <span className="num">{count('not_recorded', 'not_checked', 'error')}</span> not confirmed
              </span>
            ) : (
              <span>
                Checking <span className="num">{Object.keys(results).length}</span> of{' '}
                <span className="num">{claims.length}</span> claims…
              </span>
            )}
          </div>
          <ul className="checks checks--panel">
            {claims.map((c, i) => {
              const r = results[i];
              return (
                <li className="check" key={`${i}-${c.claim}`}>
                  <div className="check__head">
                    {r ? <Pill verdict={r.verdict} /> : <Skel w={96} h={20} />}
                    <span className="faint small">{CHECKERS[r?.checkedBy] ?? CHECKERS_BY_KIND[c.checker]}</span>
                    <span className="check__time">{r ? <Ms value={r.latencyMs ?? null} /> : null}</span>
                  </div>
                  <p className="check__claim">{c.claim}</p>
                  {r && <p className="reason small">{r.reason}</p>}
                  {r?.evidence && <Evidence evidence={r.evidence} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

const CHECKERS_BY_KIND = { jira: 'Jira', doc: 'Confluence + Jira', team: 'Teamwork Graph' };
