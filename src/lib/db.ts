import { Client, Pool } from "pg";

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

// The variable was first saved in Vercel as "DATABSE_URL" (a sensitive
// variable can't be renamed there), so both spellings are accepted.
export const databaseUrl = () => process.env.DATABASE_URL || process.env.DATABSE_URL || "";

export const dbConfigured = () => Boolean(databaseUrl());

let pool: Pool | null = null;
let poolPromise: Promise<Pool> | null = null;
let ready: Promise<void> | null = null;

const sslFor = (url: string) =>
  // Supabase's pooler presents its own certificate chain; a local test database has no TLS.
  /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : { rejectUnauthorized: false };

// Supabase's "Direct connection" host (db.<ref>.supabase.co) only answers over
// IPv6, which Vercel can't use. When the saved link is that one, the same
// project is reached through Supabase's IPv4 pooler instead: same password,
// user "postgres.<ref>", host aws-N-<region>.pooler.supabase.com:6543. The
// region isn't in the link, so every region is tried once and the one that
// accepts the login is kept.
const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2", "eu-north-1",
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2",
];

function poolerCandidates(url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const ref = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname)?.[1];
  if (!ref) return [];
  const out: string[] = [];
  for (const n of [0, 1]) {
    for (const region of REGIONS) {
      const c = new URL(url);
      c.hostname = `aws-${n}-${region}.pooler.supabase.com`;
      c.port = "6543";
      c.username = `postgres.${ref}`;
      out.push(c.toString());
    }
  }
  return out;
}

async function works(url: string) {
  const client = new Client({ connectionString: url, ssl: sslFor(url), connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
  return url;
}

async function resolveUrl() {
  const url = databaseUrl();
  const candidates = poolerCandidates(url);
  if (!candidates.length) return url;
  try {
    return await Promise.any(candidates.map(works));
  } catch (e) {
    // A wrong password shows up on the right region; report that instead.
    const wrongPassword = (e as AggregateError).errors?.find((x: { code?: string }) => x?.code === "28P01");
    if (wrongPassword) throw wrongPassword;
    return url; // let the direct link fail with its own error
  }
}

function getPool() {
  if (pool) return Promise.resolve(pool);
  poolPromise ??= resolveUrl().then(
    (url) => (pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 3 })),
    (e) => {
      poolPromise = null;
      throw e;
    },
  );
  return poolPromise;
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
create table if not exists app_files (
  id text primary key,
  content_type text not null,
  size integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);
alter table app_files enable row level security;
`;

const KEEP_VERSIONS = 300;

// Postgres asks for a retry on these: deadlock, serialization failure, lock timeout.
const RETRYABLE = new Set(["40P01", "40001", "55P03"]);

export const isRetryable = (e: unknown) => RETRYABLE.has((e as { code?: string })?.code ?? "");

/** Runs a database step again (up to 5 tries, backing off) when Postgres reports a deadlock or similar. */
export async function withRetry<T>(step: () => Promise<T>, tries = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await step();
    } catch (e) {
      if (!isRetryable(e) || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i + Math.random() * 100));
    }
  }
}

/*
 * The tables are created once. Every new server instance used to run the
 * whole SCHEMA as one transaction, and its ALTER TABLE / CREATE INDEX took
 * table locks that deadlocked (40P01) with saves running on other instances.
 * Now it first checks the catalog, which takes no table locks, and only runs
 * the setup when something is missing, one instance at a time.
 */
async function ensureSchema(p: Pool) {
  const { rows } = await p.query(`
    select coalesce(bool_and(c.relrowsecurity), false) and count(*) = 3 as ok
      from pg_class c
     where c.oid in (to_regclass('public.app_docs'), to_regclass('public.app_doc_history'), to_regclass('public.app_files'))
       and to_regclass('public.app_doc_history_key') is not null`);
  if (rows[0]?.ok) return;
  const client = await p.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('maverick-schema'))");
    await client.query("set local lock_timeout = '10s'");
    await client.query(SCHEMA);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function db() {
  const p = await getPool();
  ready ??= withRetry(() => ensureSchema(p)).then(
    () => undefined,
    (e) => {
      ready = null; // try again on the next request
      if (!databaseUrl().includes("pooler.supabase.com") && pool?.options.connectionString === databaseUrl()) {
        // Nothing usable was found; look again next time.
        void pool.end().catch(() => undefined);
        pool = null;
        poolPromise = null;
      }
      throw e;
    },
  );
  await ready;
  return p;
}

export type Doc = { rev: number; data: unknown };

export async function readDoc(key: string): Promise<Doc | null> {
  const p = await db();
  const { rows } = await withRetry(() => p.query("select rev, data from app_docs where key = $1", [key]));
  return rows[0] ? { rev: rows[0].rev, data: rows[0].data } : null;
}

/**
 * Saves a new version if `baseRev` is still the latest. Returns the new
 * revision, or the current document when someone else saved first.
 */
export async function writeDoc(key: string, baseRev: number, data: unknown): Promise<{ ok: true; rev: number } | { ok: false; current: Doc }> {
  const p = await db();
  // The whole save is one transaction, retried from the start on a deadlock: it
  // always locks the document's row first, then writes history, so two saves queue
  // instead of deadlocking. Nothing is half-saved; a failed try is rolled back.
  return withRetry(async () => {
    try {
      return await writeOnce(p, key, baseRev, data);
    } catch (e) {
      // Two first-ever saves at once: the loser sees the winner's copy as a normal conflict.
      if ((e as { code?: string }).code === "23505") {
        const current = await readDoc(key);
        if (current) return { ok: false as const, current };
      }
      throw e;
    }
  });
}

async function writeOnce(p: Pool, key: string, baseRev: number, data: unknown): Promise<{ ok: true; rev: number } | { ok: false; current: Doc }> {
  const client = await p.connect();
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
      rows[0]
        ? "update app_docs set data = $2::jsonb, rev = $3, updated_at = now() where key = $1"
        : "insert into app_docs (key, data, rev, updated_at) values ($1, $2::jsonb, $3, now())",
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

/** Files such as receipt photos, stored whole in their own table. */
export async function putFile(id: string, contentType: string, data: Buffer) {
  await (await db()).query(
    `insert into app_files (id, content_type, size, data) values ($1, $2, $3, $4)
     on conflict (id) do update set content_type = excluded.content_type, size = excluded.size, data = excluded.data`,
    [id, contentType, data.length, data],
  );
}

export async function getFile(id: string): Promise<{ contentType: string; data: Buffer } | null> {
  const { rows } = await (await db()).query("select content_type, data from app_files where id = $1", [id]);
  return rows[0] ? { contentType: rows[0].content_type, data: rows[0].data } : null;
}

export async function deleteFile(id: string) {
  await (await db()).query("delete from app_files where id = $1", [id]);
}
