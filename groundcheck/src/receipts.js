/**
 * Groundcheck: receipts.
 *
 * Every claim Groundcheck checks is saved as a "receipt" in Forge SQL (a
 * database hosted by Atlassian, private to this app installation), so people
 * can see later what was checked, the verdict and the evidence.
 *
 * Privacy rules:
 *  - A receipt can quote evidence from a page only its author may read, so
 *    receipts are only ever shown to the person who made them.
 *  - Site-wide numbers are aggregate counts only, never claim text.
 *  - Receipts are deleted after RETENTION_DAYS (see purgeOldReceipts).
 */
import { sql, migrationRunner } from '@forge/sql';
import { randomUUID } from 'node:crypto';
import { privacy } from '@forge/api';

export const RETENTION_DAYS = 90;

// Schema changes are append-only migrations; Forge SQL records which ones ran.
const migrations = migrationRunner.enqueue(
  'v001_create_receipts',
  `CREATE TABLE IF NOT EXISTS receipts (
     id VARCHAR(36) PRIMARY KEY,
     created_at DATETIME NOT NULL,
     account_id VARCHAR(128) NOT NULL,
     checker VARCHAR(32) NOT NULL,
     verdict VARCHAR(16) NOT NULL,
     claim VARCHAR(600) NOT NULL,
     issue_key VARCHAR(32) NULL,
     evidence TEXT NULL,
     INDEX idx_account_created (account_id, created_at),
     INDEX idx_issue_account (issue_key, account_id)
   )`
).enqueue(
  // How long each check took, so the dashboard can show each source's speed.
  'v002_add_latency',
  'ALTER TABLE receipts ADD COLUMN latency_ms INT NULL'
).enqueue(
  // The dashboard's timeline and stats filter by date first.
  'v003_index_created',
  'CREATE INDEX idx_created ON receipts (created_at)'
);

let schemaReady = null;

/** Run pending migrations once per function instance. */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = migrations.run().catch((e) => {
      schemaReady = null; // Let the next call retry.
      throw e;
    });
  }
  return schemaReady;
}

/** MySQL DATETIME text for a JS date. */
const toSqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Save one receipt. Never throws: a storage problem must not stop the user
 * from getting their verdict.
 */
export async function saveReceipt({ accountId, checker, verdict, claim, issueKey, evidence, latencyMs = null }) {
  if (!accountId || verdict === 'invalid_input') return;
  try {
    await ensureSchema();
    await sql
      .prepare(
        `INSERT INTO receipts (id, created_at, account_id, checker, verdict, claim, issue_key, evidence, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bindParams(
        randomUUID(),
        toSqlDate(new Date()),
        accountId,
        checker,
        verdict,
        String(claim).slice(0, 600),
        issueKey ?? null,
        evidence ? JSON.stringify(evidence).slice(0, 8000) : null,
        Number.isFinite(latencyMs) ? Math.round(latencyMs) : null
      )
      .execute();
  } catch (e) {
    console.error('Could not save receipt', e?.message);
  }
}

const parseRow = (r) => ({
  id: r.id,
  createdAt: r.created_at,
  checker: r.checker,
  verdict: r.verdict,
  claim: r.claim,
  issueKey: r.issue_key,
  evidence: r.evidence ? safeJson(r.evidence) : null,
  latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
});

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The current user's receipts, newest first, optionally for one issue. */
export async function listMyReceipts(accountId, { issueKey = null, limit = 20 } = {}) {
  await ensureSchema();
  const n = Math.max(1, Math.min(Number(limit) || 20, 100));
  const stmt = issueKey
    ? sql
        .prepare(
          `SELECT * FROM receipts WHERE account_id = ? AND issue_key = ?
           ORDER BY created_at DESC LIMIT ${n}`
        )
        .bindParams(accountId, issueKey)
    : sql
        .prepare(`SELECT * FROM receipts WHERE account_id = ? ORDER BY created_at DESC LIMIT ${n}`)
        .bindParams(accountId);
  const { rows } = await stmt.execute();
  return rows.map(parseRow);
}

/** Site-wide verdict counts for the last 30 days (no claim text). */
export async function verdictCounts() {
  await ensureSchema();
  const since = toSqlDate(new Date(Date.now() - 30 * 24 * 3600 * 1000));
  const { rows } = await sql
    .prepare(
      `SELECT checker, verdict, COUNT(*) AS n FROM receipts
       WHERE created_at >= ? GROUP BY checker, verdict`
    )
    .bindParams(since)
    .execute();
  return rows.map((r) => ({ checker: r.checker, verdict: r.verdict, count: Number(r.n) }));
}

/**
 * Site-wide verdicts per day (UTC) for the last `days` days, counts only.
 * Days with no checks are filled with zeros, so the chart shows every day.
 * @returns {Promise<Array<{day: string, counts: Record<string, number>}>>}
 */
export async function verdictTimeline(days = 14) {
  await ensureSchema();
  const n = Math.max(1, Math.min(Number(days) || 14, 90));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const { rows } = await sql
    .prepare(
      `SELECT DATE(created_at) AS d, verdict, COUNT(*) AS c FROM receipts
       WHERE created_at >= ? GROUP BY DATE(created_at), verdict`
    )
    .bindParams(toSqlDate(start))
    .execute();

  // One entry per day, oldest first, each with a count for every verdict seen.
  const byDay = new Map();
  for (let i = 0; i < n; i++) {
    const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    byDay.set(day, {});
  }
  for (const r of rows) {
    // DATE() may come back as "2026-11-22" or a full timestamp, depending on the driver.
    const day = String(r.d).slice(0, 10);
    if (byDay.has(day)) byDay.get(day)[r.verdict] = Number(r.c);
  }
  return [...byDay].map(([day, counts]) => ({ day, counts }));
}

/**
 * Per checker, last 30 days, site-wide: how many checks, how many caught a
 * wrong claim, and how long checks took. Counts and timings only.
 */
export async function checkerStats() {
  await ensureSchema();
  const since = toSqlDate(new Date(Date.now() - 30 * 24 * 3600 * 1000));
  const { rows } = await sql
    .prepare(
      `SELECT checker,
              COUNT(*) AS total,
              SUM(CASE WHEN verdict IN ('contradicted', 'conflict') THEN 1 ELSE 0 END) AS wrong,
              AVG(latency_ms) AS avg_ms,
              MAX(latency_ms) AS max_ms
       FROM receipts WHERE created_at >= ? GROUP BY checker`
    )
    .bindParams(since)
    .execute();
  return rows.map((r) => ({
    checker: r.checker,
    total: Number(r.total),
    wrong: Number(r.wrong ?? 0),
    avgMs: r.avg_ms == null ? null : Math.round(Number(r.avg_ms)),
    maxMs: r.max_ms == null ? null : Number(r.max_ms),
  }));
}

/**
 * GDPR: tell Atlassian which accounts we hold data for, and erase everything
 * stored for accounts that have been closed. Atlassian answers with only the
 * accounts that changed. We store no profile data (names, emails), only the
 * account ID, so "updated" accounts need no action. Run daily.
 *
 * @returns {Promise<{reported: number, erased: number}>}
 */
export async function reportAndEraseClosedAccounts() {
  await ensureSchema();
  const { rows } = await sql
    .prepare('SELECT account_id, MAX(created_at) AS last_at FROM receipts GROUP BY account_id')
    .execute();
  if (rows.length === 0) return { reported: 0, erased: 0 };

  const accounts = rows.map((r) => ({
    accountId: r.account_id,
    updatedAt: (parseSqlDate(r.last_at) ?? new Date()).toISOString(),
  }));
  const updates = await privacy.reportPersonalData(accounts);

  let erased = 0;
  for (const u of updates ?? []) {
    if (u.status === 'closed') {
      await sql.prepare('DELETE FROM receipts WHERE account_id = ?').bindParams(u.accountId).execute();
      erased += 1;
    }
  }
  return { reported: accounts.length, erased };
}

/** Read a MySQL DATETIME (UTC) or a Date back into a Date. */
function parseSqlDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Delete receipts older than the retention period. Run daily. */
export async function purgeOldReceipts() {
  await ensureSchema();
  const cutoff = toSqlDate(new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000));
  await sql.prepare('DELETE FROM receipts WHERE created_at < ?').bindParams(cutoff).execute();
}
