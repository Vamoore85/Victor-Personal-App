import { Pool } from "pg";

/*
 * The app's database: Victor's Supabase project "Maverick Personal App",
 * reached through the DATABASE_URL environment variable in Vercel (the
 * Supabase "Transaction pooler" connection string). Only this server code
 * connects; row-level security with no policies keeps Supabase's public API
 * from reading the tables.
 *
 * Each document (for now just "money", the whole Financial Center) is one
 * JSON row with a revision number. Every save also lands in app_doc_history,
 * which keeps the last few hundred versions as backups.
 */

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool() {
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    // Supabase's pooler presents its own certificate chain; a local test database has no TLS.
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false },
    max: 3,
  });
  return pool;
}

const SCHEMA = `
create table if not exists app_docs (
  key text primary key,
  data jsonb not null,
  rev integer not null,
  updated_at timestamptz not null default now()
);
create table if not exists app_doc_history (
  id bigserial primary key,
  key text not null,
  rev integer not null,
  data jsonb not null,
  saved_at timestamptz not null default now()
);
create index if not exists app_doc_history_key on app_doc_history (key, id desc);
alter table app_docs enable row level security;
alter table app_doc_history enable row level security;
`;

const KEEP_VERSIONS = 300;

async function db() {
  const p = getPool();
  ready ??= p.query(SCHEMA).then(
    () => undefined,
    (e) => {
      ready = null; // try again on the next request
      throw e;
    },
  );
  await ready;
  return p;
}

export type Doc = { rev: number; data: unknown };

export async function readDoc(key: string): Promise<Doc | null> {
  const { rows } = await (await db()).query("select rev, data from app_docs where key = $1", [key]);
  return rows[0] ? { rev: rows[0].rev, data: rows[0].data } : null;
}

/**
 * Saves a new version if `baseRev` is still the latest. Returns the new
 * revision, or the current document when someone else saved first.
 */
export async function writeDoc(key: string, baseRev: number, data: unknown): Promise<{ ok: true; rev: number } | { ok: false; current: Doc }> {
  const client = await (await db()).connect();
  try {
    await client.query("begin");
    const { rows } = await client.query("select rev, data from app_docs where key = $1 for update", [key]);
    const currentRev: number = rows[0]?.rev ?? 0;
    if (currentRev !== baseRev) {
      await client.query("rollback");
      return { ok: false, current: { rev: currentRev, data: rows[0]?.data ?? null } };
    }
    const rev = currentRev + 1;
    const json = JSON.stringify(data);
    await client.query(
      `insert into app_docs (key, data, rev, updated_at) values ($1, $2::jsonb, $3, now())
       on conflict (key) do update set data = excluded.data, rev = excluded.rev, updated_at = now()`,
      [key, json, rev],
    );
    await client.query("insert into app_doc_history (key, rev, data) values ($1, $2, $3::jsonb)", [key, rev, json]);
    await client.query(
      `delete from app_doc_history where key = $1 and id not in
         (select id from app_doc_history where key = $1 order by id desc limit ${KEEP_VERSIONS})`,
      [key],
    );
    await client.query("commit");
    return { ok: true, rev };
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
