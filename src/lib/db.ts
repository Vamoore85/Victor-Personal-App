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
`;

const KEEP_VERSIONS = 300;

async function db() {
  const p = await getPool();
  ready ??= p.query(SCHEMA).then(
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
