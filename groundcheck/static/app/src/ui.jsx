import React from 'react';
import { router } from '@forge/bridge';

/**
 * Shared pieces of the Groundcheck terminal UI: the verdict vocabulary, the
 * product mark, number and time formatting, evidence, and loading bars.
 */

// Every verdict a checker can return: its label, its pill tone and the CSS
// colour of its chart mark. The order is the order used in every chart and
// legend, so one verdict always has one colour and one place.
export const VERDICTS = {
  verified: { label: 'Verified', tone: 'verified', mark: 'var(--verified)' },
  contradicted: { label: 'Contradicted', tone: 'contradicted', mark: 'var(--contradicted)' },
  conflict: { label: 'Sources disagree', tone: 'conflict', mark: 'var(--conflict)' },
  not_recorded: { label: 'Not recorded', tone: 'neutral', mark: 'var(--unrecorded)' },
  not_checked: { label: 'Not checked', tone: 'warning', mark: null }, // drawn as an outline
  invalid_input: { label: 'Invalid input', tone: 'neutral', mark: null },
  error: { label: 'Error', tone: 'contradicted', mark: null },
};
export const VERDICT_ORDER = ['verified', 'contradicted', 'conflict', 'not_recorded', 'not_checked'];

export const CHECKERS = {
  'jira-exact': 'Jira',
  'confluence-judge': 'Confluence + Jira',
  'teamwork-graph': 'Teamwork Graph',
};

export function Pill({ verdict }) {
  const v = VERDICTS[verdict] ?? { label: String(verdict), tone: 'neutral' };
  return <span className={`pill pill--${v.tone}`}>{v.label}</span>;
}

/** A small swatch that is the chart mark it stands for, scaled down. */
export function Swatch({ verdict }) {
  const mark = VERDICTS[verdict]?.mark;
  return mark ? (
    <span className="swatch" style={{ background: mark }} aria-hidden="true" />
  ) : (
    <span className="swatch swatch--outline" aria-hidden="true" />
  );
}

/**
 * The Groundcheck mark: a check resting on a ground line, in the accent.
 * Drawn for this product, from its name.
 */
export function Mark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="19" height="19" rx="3" fill="none" stroke="var(--accent)" />
      <path d="M5 9.5 8.4 12.8 15 5.6" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="square" />
      <path d="M4 15.5h12" stroke="var(--accent)" strokeWidth="1.6" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 1.5v3.2H9.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A flat bar standing in for a value while it loads, at the value's real size. */
export const Skel = ({ w = 48, h = 12 }) => <span className="skel" style={{ width: w, height: h }} />;

// --- Formatting -----------------------------------------------------------

/** Parse the SQL "YYYY-MM-DD HH:MM:SS" (UTC) or an ISO string. */
export function parseTime(value) {
  if (!value) return null;
  const s = String(value);
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t;
}

/** "14:32" today, "Yesterday", or "18 Nov". */
export function shortTime(value) {
  const t = parseTime(value);
  if (!t) return '—';
  const now = new Date();
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const yesterday = new Date(now.getTime() - 86400000);
  if (t.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return t.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** "just now", "12 min ago", "3 h ago", "5 d ago". */
export function timeAgo(value) {
  const t = parseTime(value);
  if (!t) return '—';
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

/** Milliseconds as "840 ms" or "4.2 s"; a dash when unknown. */
export function Ms({ value }) {
  if (value == null) return <span className="dash">—</span>;
  return value < 1000 ? (
    <span className="num">
      {value}
      <span className="unit">ms</span>
    </span>
  ) : (
    <span className="num">
      {(value / 1000).toFixed(1)}
      <span className="unit">s</span>
    </span>
  );
}

/** A share as "31.6%", or a dash when there is nothing to divide. */
export const pct = (part, whole) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '—');

/** Open a site-relative Atlassian link in the main window. */
export function openLink(e, url) {
  e.preventDefault();
  e.stopPropagation();
  router.navigate(url);
}

/** One line naming the evidence, for a table cell. */
export function evidenceSummary(ev) {
  if (!ev) return null;
  if (ev.source === 'jira') return `${ev.issueKey} · ${ev.field} = ${ev.actualValue ?? 'empty'}`;
  if (ev.source === 'teamwork-graph') return `${ev.person} · ${ev.teams?.length ?? 0} teams`;
  if (ev.source === 'documents') return ev.items?.map((i) => i.title).join(' · ') ?? null;
  if (ev.source === 'confluence') return ev.title;
  return null;
}

/**
 * A quote as people read it: table-cell separators ("a | b |") from
 * Confluence tables and Jira record lines become " · ". Display only; the
 * stored quote is what was verified against the page.
 */
export const readableQuote = (q) =>
  String(q ?? '')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '')
    .trim();

/** The full evidence behind a verdict. */
export function Evidence({ evidence }) {
  if (!evidence) return <p className="muted">No record addresses this claim.</p>;

  if (evidence.source === 'jira') {
    return (
      <ul className="evidence">
        <li>
          <span className="evidence__stance faint">Jira</span>
          <span>
            <span className="muted">{evidence.field} is </span>
            <span className="evidence__quote">{evidence.actualValue ?? 'empty'}</span>
            <span className="muted"> on </span>
            <a className="mono" href={evidence.url} onClick={(e) => openLink(e, evidence.url)}>
              {evidence.issueKey}
            </a>
          </span>
        </li>
      </ul>
    );
  }

  if (evidence.source === 'teamwork-graph') {
    return (
      <ul className="evidence">
        <li>
          <span className="evidence__stance faint">Teams</span>
          <span>
            <span className="evidence__quote">{evidence.person}</span>
            <span className="muted">
              {' '}
              is on {evidence.teams?.length ? evidence.teams.slice(0, 10).join(', ') : 'no visible teams'}
              {evidence.teams?.length > 10 ? ` and ${evidence.teams.length - 10} more` : ''}
            </span>
          </span>
        </li>
      </ul>
    );
  }

  // Document evidence: one line per verified quote. Older receipts hold one quote.
  const items =
    evidence.source === 'documents'
      ? evidence.items ?? []
      : [{ ...evidence, stance: null, kind: 'confluence' }];
  return (
    <ul className="evidence">
      {items.map((item) => (
        <li key={`${item.id ?? item.pageId}-${item.quote}`}>
          <span
            className={`evidence__stance ${
              item.stance === 'supports'
                ? 'evidence__stance--yes'
                : item.stance === 'contradicts'
                ? 'evidence__stance--no'
                : 'faint'
            }`}
          >
            {item.stance === 'supports' ? 'Says yes' : item.stance === 'contradicts' ? 'Says no' : 'Quote'}
          </span>
          <span>
            <span className="evidence__quote">“{readableQuote(item.quote)}”</span>{' '}
            <span className="evidence__source">
              ·{' '}
              {item.url ? (
                <a href={item.url} onClick={(e) => openLink(e, item.url)}>
                  {item.title}
                </a>
              ) : (
                item.title
              )}
            </span>{' '}
            {item.archived && <span className="tag">archived</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
