import React, { useEffect, useRef, useState } from 'react';
import { VERDICTS, VERDICT_ORDER } from './ui.jsx';

/**
 * Small SVG charts for the terminal, drawn to the dashboard's rules:
 * one scale, round ticks above the maximum, 3-5 faint gridlines, no y-axis
 * line, flat x labels, a 2px seam between stacked parts, and a hover readout
 * instead of numbers on every bar.
 */

/** Track an element's width, so charts draw at their real pixel size. */
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round tick step (1, 2, 5, 10, 20, 50...) giving 3-5 ticks with the top one above `max`. */
export function niceTicks(max) {
  const top = Math.max(max, 1);
  for (const base of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    const count = Math.floor(top / base) + 1; // ticks needed so the top tick exceeds max
    if (count <= 4) return Array.from({ length: count + 1 }, (_, i) => i * base);
  }
  return [0, top];
}

const dayLabel = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Verdicts per day as stacked columns.
 * @param {{days: Array<{day: string, counts: Record<string, number>}>}} props
 */
export function DailyVerdicts({ days }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState(null);

  const height = 196;
  const pad = { top: 8, right: 4, bottom: 22, left: 28 };
  const totals = days.map((d) => VERDICT_ORDER.reduce((s, v) => s + (d.counts[v] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(4, Math.min(28, slot * 0.62));
  const y = (v) => pad.top + plotH - (v / top) * plotH;
  // Flat labels about 56px apart at most, counted back from today so the
  // last label is always "Today": 7 labels on a desktop, 4 on a phone.
  const fits = Math.max(2, Math.min(7, Math.floor(plotW / 64)));
  const labelEvery = Math.max(1, Math.ceil(days.length / fits));

  const shown = active ?? days.length - 1;
  const focus = days[shown];

  return (
    <div>
      <div className="readout" aria-live="polite">
        {focus ? (
          <>
            <span className="num">{dayLabel(focus.day)}</span>
            <span>
              <span className="num">{totals[shown]}</span> checked
            </span>
            {VERDICT_ORDER.filter((v) => focus.counts[v]).map((v) => (
              <span key={v}>
                <span className="num">{focus.counts[v]}</span> {VERDICTS[v].label.toLowerCase()}
              </span>
            ))}
          </>
        ) : null}
      </div>
      <div ref={ref} style={{ marginTop: 8 }}>
        {width > 0 && (
          <svg className="chart" width={width} height={height} role="img" aria-label="Verdicts per day, last 14 days">
            {ticks.map((t) => (
              <g key={t}>
                <line
                  className={t === 0 ? 'baseline' : 'gridline'}
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y(t) + 0.5}
                  y2={y(t) + 0.5}
                />
                <text x={pad.left - 8} y={y(t) + 4} textAnchor="end">
                  {t}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = pad.left + i * slot + (slot - barW) / 2;
              let acc = 0;
              const parts = VERDICT_ORDER.filter((v) => d.counts[v]).map((v) => {
                const h = (d.counts[v] / top) * plotH;
                const rect = { v, y: y(acc) - h, h };
                acc += d.counts[v];
                return rect;
              });
              return (
                <g key={d.day}>
                  {parts.map((p, j) => {
                    // A 2px seam (the surface showing through) between stacked parts.
                    const seam = j < parts.length - 1 ? 2 : 0;
                    const h = Math.max(1, p.h - seam);
                    const mark = VERDICTS[p.v].mark;
                    return mark ? (
                      <rect key={p.v} x={x} y={p.y + seam} width={barW} height={h} fill={mark} />
                    ) : (
                      <rect
                        key={p.v}
                        x={x + 0.5}
                        y={p.y + seam + 0.5}
                        width={barW - 1}
                        height={Math.max(0, h - 1)}
                        fill="none"
                        stroke="var(--faint)"
                      />
                    );
                  })}
                  {i % labelEvery === (days.length - 1) % labelEvery && (
                    <text x={pad.left + i * slot + slot / 2} y={height - 6} textAnchor="middle">
                      {i === days.length - 1 ? 'Today' : dayLabel(d.day)}
                    </text>
                  )}
                  <rect
                    className={`hit${active === i ? ' is-active' : ''}`}
                    x={pad.left + i * slot}
                    y={pad.top}
                    width={slot}
                    height={plotH}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

/** The share of each verdict as one 100% bar with 2px seams. */
export function Composition({ totals }) {
  const sum = VERDICT_ORDER.reduce((s, v) => s + (totals[v] ?? 0), 0);
  if (sum === 0) return <div className="composition composition--empty" aria-hidden="true" />;
  return (
    <div className="composition" role="img" aria-label="Share of each verdict">
      {VERDICT_ORDER.filter((v) => totals[v]).map((v) => (
        <span
          key={v}
          title={`${VERDICTS[v].label}: ${totals[v]}`}
          style={{
            flexGrow: totals[v],
            background: VERDICTS[v].mark ?? 'transparent',
            boxShadow: VERDICTS[v].mark ? 'none' : 'inset 0 0 0 1px var(--faint)',
          }}
        />
      ))}
    </div>
  );
}
