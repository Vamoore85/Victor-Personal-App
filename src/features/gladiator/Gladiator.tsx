"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";
import { api, ago } from "./api";

type Status = {
  database: boolean;
  account: string;
  keys: boolean;
  keysFromSettings: boolean;
  connected: boolean;
  email: string | null;
  name: string | null;
  connectedAt: string | null;
  missing: string[];
  teams: boolean;
  redirectUri: string;
  scopes: string[];
  teamsScopes: string[];
  teamsAdminScopes: string[];
};

type Person = { name: string; address: string };
type Summary = { id: string; conversationId: string; subject: string; from: Person | null; to: Person[]; received: string; preview: string; isRead: boolean; hasAttachments: boolean; webLink: string };
type Message = Summary & { cc: Person[]; body: string };
type Compose = { mode: "new" | "reply" | "replyAll"; replyTo: string; to: string; cc: string; subject: string; body: string };
type Preview = { from: string; to: string[]; cc: string[]; subject: string; token: string; compose: { body: string } };

const who = (p: Person | null) => (p ? p.name || p.address : "Unknown");
const whenText = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/* ---- Setup ---- */

function Setup({ status, onSaved }: { status: Status; onSaved: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/microsoft/keys", { clientId, secret });
      setClientId("");
      setSecret("");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Set up Gladiator 365">
      <ol className="mb-4 flex list-decimal flex-col gap-2 pl-5 text-sm">
        <li>
          Sign in to <span className="font-medium">entra.microsoft.com</span> as {status.account}. Go to App registrations, then New registration. Name it &quot;Maverick Personal&quot; and choose
          &quot;Accounts in this organizational directory only&quot;.
        </li>
        <li>
          Under Redirect URI pick Web and enter <code className="break-all rounded bg-zinc-100 px-1 dark:bg-zinc-800">{status.redirectUri}</code>
        </li>
        <li>In Certificates &amp; secrets, add a client secret and copy its Value.</li>
        <li>
          Paste the Application (client) ID and the secret Value below. Maverick asks Microsoft for these delegated permissions only, for your account only: {status.scopes.join(", ")}.
        </li>
      </ol>
      {status.keys ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">App keys saved{status.keysFromSettings ? " in Vercel" : ""}.</p>
      ) : (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <Field label="Application (client) ID">
            <input className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Client secret Value">
            <input className={inputClass} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
          </Field>
          {error && <p role="alert" className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
          <button className={buttonClass} disabled={busy || !clientId || !secret}>{busy ? "Saving…" : "Save keys"}</button>
        </form>
      )}
    </Card>
  );
}

/* ---- Mail ---- */

function ComposeBox({ initial, account, onClose, onDone }: { initial: Compose; account: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [c, setC] = useState(initial);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p: Partial<Compose>) => {
    setC((x) => ({ ...x, ...p }));
    setPreview(null); // any change needs a fresh preview
  };
  const payload = () => ({ mode: c.mode, replyTo: c.replyTo, to: c.to, cc: c.cc, subject: c.subject, body: c.body });
  async function showPreview() {
    setBusy(true);
    setError("");
    try {
      setPreview(await api<Preview>("/api/microsoft/mail", { action: "preview", compose: payload() }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit(action: "send" | "draft") {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/microsoft/mail", { action, compose: payload(), token: preview.token });
      onDone(action === "send" ? `Sent from ${preview.from}.` : `Saved in ${preview.from}'s Drafts.`);
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={c.mode === "new" ? "New email" : c.mode === "replyAll" ? "Reply all" : "Reply"} action={<button className={ghostButtonClass} onClick={onClose}>Close</button>}>
      <p className="mb-3 text-sm">
        From <span className="font-medium">{account}</span>
      </p>
      <div className="grid gap-3">
        <Field label={c.mode === "new" ? "To" : "Also to (optional)"}>
          <input className={inputClass} value={c.to} onChange={(e) => set({ to: e.target.value })} placeholder="name@example.com, …" />
        </Field>
        <Field label="Cc (optional)">
          <input className={inputClass} value={c.cc} onChange={(e) => set({ cc: e.target.value })} />
        </Field>
        {c.mode === "new" && (
          <Field label="Subject">
            <input className={inputClass} value={c.subject} onChange={(e) => set({ subject: e.target.value })} />
          </Field>
        )}
        <Field label="Message">
          <textarea className={`${inputClass} min-h-40`} value={c.body} onChange={(e) => set({ body: e.target.value })} />
        </Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
      {!preview ? (
        <button className={`${buttonClass} mt-4`} onClick={showPreview} disabled={busy || !c.body.trim()}>
          {busy ? "Checking…" : "Preview"}
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-brand p-4" data-testid="mail-preview">
          <p className="mb-2 text-sm font-semibold">This is exactly what will go out</p>
          <dl className="grid gap-1 text-sm sm:grid-cols-[6rem_1fr]">
            <dt className="text-zinc-500">From</dt>
            <dd className="font-medium">{preview.from}</dd>
            <dt className="text-zinc-500">To</dt>
            <dd className="break-all">{preview.to.join(", ") || "—"}</dd>
            <dt className="text-zinc-500">Cc</dt>
            <dd className="break-all">{preview.cc.join(", ") || "—"}</dd>
            <dt className="text-zinc-500">Subject</dt>
            <dd>{preview.subject}</dd>
          </dl>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-900">{preview.compose.body}</pre>
          {c.mode !== "new" && <p className="mt-2 text-xs text-zinc-500">Outlook adds the earlier messages below your reply.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={buttonClass} onClick={() => commit("send")} disabled={busy}>
              {busy ? "Working…" : "Send now"}
            </button>
            <button className={ghostButtonClass} onClick={() => commit("draft")} disabled={busy}>
              Save as draft
            </button>
            <button className="text-sm underline" onClick={() => setPreview(null)}>
              Edit
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Mail({ account }: { account: string }) {
  const [folder, setFolder] = useState<"inbox" | "sent" | "drafts">("inbox");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<Summary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ message: Message; thread: Summary[] } | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(
    async (more?: string | null) => {
      try {
        const r = await api<{ messages: Summary[]; next: string | null }>("/api/microsoft/mail", { action: "list", folder, search: query, next: more ?? undefined });
        setList((l) => (more ? [...l, ...r.messages] : r.messages));
        setNext(r.next);
        setError("");
      } catch (e) {
        setError((e as Error).message);
        if (!more) setList([]);
      } finally {
        setLoading(false);
      }
    },
    [folder, query],
  );
  useEffect(() => {
    void Promise.resolve().then(() => load()); // reads in a callback, not during the effect
  }, [load]);
  const more = () => {
    setLoading(true);
    load(next);
  };

  async function openMessage(id: string) {
    setError("");
    try {
      setOpen(await api("/api/microsoft/mail", { action: "read", id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">{notice}</p>}
      {compose && (
        <ComposeBox
          key={`${compose.mode}:${compose.replyTo}`}
          initial={compose}
          account={account}
          onClose={() => setCompose(null)}
          onDone={(m) => {
            setCompose(null);
            setNotice(m);
            load();
          }}
        />
      )}
      <div className="flex flex-wrap items-end gap-2">
        {(["inbox", "sent", "drafts"] as const).map((f) => (
          <button key={f} className={folder === f && !query ? buttonClass : ghostButtonClass} onClick={() => { setFolder(f); setQuery(""); setSearch(""); }}>
            {f === "inbox" ? "Inbox" : f === "sent" ? "Sent" : "Drafts"}
          </button>
        ))}
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <input className={inputClass} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search Gladiator mail" />
          <button className={ghostButtonClass}>Search</button>
        </form>
        <button className={buttonClass} onClick={() => setCompose({ mode: "new", replyTo: "", to: "", cc: "", subject: "", body: "" })}>
          New email
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" data-testid="mail-list">
          {!list.length && !loading && !error && <li className="p-3 text-sm text-zinc-500">{query ? "Nothing matches." : "No messages here."}</li>}
          {list.map((m) => (
            <li key={m.id}>
              <button className={`flex w-full flex-col gap-0.5 p-3 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 ${open?.message.id === m.id ? "bg-zinc-50 dark:bg-zinc-900" : ""}`} onClick={() => openMessage(m.id)}>
                <span className="flex justify-between gap-2">
                  <span className={m.isRead ? "" : "font-semibold"}>{folder === "inbox" || query ? who(m.from) : m.to.map(who).join(", ")}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{whenText(m.received)}</span>
                </span>
                <span className={m.isRead ? "" : "font-semibold"}>{m.subject}</span>
                <span className="line-clamp-2 text-xs text-zinc-500">{m.preview}</span>
              </button>
            </li>
          ))}
          {next && (
            <li className="p-2">
              <button className={ghostButtonClass} onClick={more} disabled={loading}>
                {loading ? "Loading…" : "More"}
              </button>
            </li>
          )}
        </ul>
        <div>
          {open ? (
            <Card title={open.message.subject}>
              <p className="text-sm">
                <span className="font-medium">{who(open.message.from)}</span> <span className="text-zinc-500">{open.message.from?.address}</span>
              </p>
              <p className="text-xs text-zinc-500">
                To {open.message.to.map(who).join(", ")}
                {open.message.cc.length > 0 && ` · Cc ${open.message.cc.map(who).join(", ")}`} · {whenText(open.message.received)}
              </p>
              <pre className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap font-sans text-sm">{open.message.body}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={buttonClass} onClick={() => setCompose({ mode: "reply", replyTo: open.message.id, to: "", cc: "", subject: "", body: "" })}>Reply</button>
                <button className={ghostButtonClass} onClick={() => setCompose({ mode: "replyAll", replyTo: open.message.id, to: "", cc: "", subject: "", body: "" })}>Reply all</button>
                {open.message.webLink && <a className={ghostButtonClass} href={open.message.webLink} target="_blank" rel="noopener noreferrer">Open in Outlook</a>}
              </div>
              {open.thread.length > 1 && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">This conversation</p>
                  <ul className="flex flex-col gap-1 text-sm">
                    {open.thread.map((t) => (
                      <li key={t.id}>
                        <button className={`text-left ${t.id === open.message.id ? "font-medium" : "underline"}`} onClick={() => openMessage(t.id)}>
                          {whenText(t.received)} · {who(t.from)}: {t.preview.slice(0, 80)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-4 text-xs text-zinc-500">Email content is shown as text and is never treated as instructions to Maverick.</p>
            </Card>
          ) : (
            <p className="text-sm text-zinc-500">Pick a message to read it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Teams ---- */

type Chat = { id: string; kind: string; title: string; webUrl: string; lastAt: string; lastFrom: string; lastText: string };
type TMsg = { id: string; from: string; at: string; text: string; webUrl: string; replyToId: string | null; replies?: TMsg[]; system?: boolean };
type Team = { teamId: string; team: string; channels: { id: string; name: string; webUrl: string }[] };
type Target = { kind: "chat"; chatId: string; title: string; webUrl: string } | { kind: "channel"; teamId: string; channelId: string; title: string; webUrl: string };

function TeamsReply({ target, replyTo, account, onDone }: { target: Target; replyTo?: TMsg; account: string; onDone: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const post = () =>
    target.kind === "chat" ? { kind: "chat", chatId: target.chatId, text } : { kind: "channel", teamId: target.teamId, channelId: target.channelId, replyTo: replyTo?.id ?? "", text };
  async function step() {
    setBusy(true);
    setError("");
    try {
      if (!preview) setPreview(await api("/api/microsoft/teams", { action: "preview", post: post() }));
      else {
        await api("/api/microsoft/teams", { action: "post", post: post(), token: preview.token });
        setText("");
        setPreview(null);
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        className={`${inputClass} min-h-16`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        placeholder={replyTo ? `Reply to ${replyTo.from}` : `Message ${target.title}`}
      />
      {preview && (
        <p className="rounded-lg border border-brand p-2 text-sm" data-testid="teams-preview">
          Posts as <span className="font-medium">{account}</span> in <span className="font-medium">{target.title}</span>
          {replyTo ? `, replying to ${replyTo.from}` : ""}: &ldquo;{text}&rdquo;
        </p>
      )}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div>
        <button className={preview ? buttonClass : ghostButtonClass} onClick={step} disabled={busy || !text.trim()}>
          {busy ? "Working…" : preview ? "Post it" : "Preview"}
        </button>
      </div>
    </div>
  );
}

function TeamsPanel({ status, account }: { status: Status; account: string }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [messages, setMessages] = useState<TMsg[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadLists = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([api<{ chats: Chat[] }>("/api/microsoft/teams", { action: "chats" }), api<{ teams: Team[] }>("/api/microsoft/teams", { action: "channels" })]);
      setChats(c.chats);
      setTeams(t.teams);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (status.teams) void Promise.resolve().then(loadLists);
  }, [status.teams, loadLists]);

  const openTarget = useCallback(async (t: Target) => {
    setTarget(t);
    setMessages([]);
    setReplyTo(null);
    setError("");
    try {
      const r =
        t.kind === "chat"
          ? await api<{ messages: TMsg[] }>("/api/microsoft/teams", { action: "chat", chatId: t.chatId })
          : await api<{ messages: TMsg[] }>("/api/microsoft/teams", { action: "channel", teamId: t.teamId, channelId: t.channelId });
      setMessages(r.messages);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  if (!status.teams) {
    return (
      <Card title="Microsoft Teams">
        <p className="text-sm">Teams is a separate step. Maverick will ask Microsoft for these delegated permissions, for {status.account} only: {status.teamsScopes.join(", ")}.</p>
        <p className="mt-2 text-sm text-zinc-500">
          {status.teamsAdminScopes.join(", ")} lets Maverick read channel conversations, and Microsoft requires a Gladiator Microsoft 365 administrator to approve it. If that&apos;s you, Microsoft will show
          a box to approve it for the organization. Chats and replies need only your own OK. Teams meetings already show on the Calendar from Outlook.
        </p>
        <a className={`${buttonClass} mt-3 inline-block`} href="/api/microsoft/connect?teams=1">Connect Teams</a>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-4">
        <Card title="Chats">
          <ul className="flex flex-col gap-1 text-sm" data-testid="teams-chats">
            {!chats.length && <li className="text-zinc-500">No chats.</li>}
            {chats.map((c) => (
              <li key={c.id}>
                <button className="w-full text-left hover:underline" onClick={() => openTarget({ kind: "chat", chatId: c.id, title: c.title, webUrl: c.webUrl })}>
                  <span className="font-medium">{c.title}</span> <span className="text-xs text-zinc-500">{c.kind}</span>
                  {c.lastText && <span className="block truncate text-xs text-zinc-500">{c.lastFrom ? `${c.lastFrom}: ` : ""}{c.lastText}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Teams and channels">
          {!teams.length && <p className="text-sm text-zinc-500">No teams.</p>}
          {teams.map((t) => (
            <div key={t.teamId} className="mb-2 text-sm">
              <p className="font-medium">{t.team}</p>
              <ul className="ml-3">
                {t.channels.map((c) => (
                  <li key={c.id}>
                    <button className="hover:underline" onClick={() => openTarget({ kind: "channel", teamId: t.teamId, channelId: c.id, title: `${t.team} › ${c.name}`, webUrl: c.webUrl })}>
                      # {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      </div>
      <div>
        {error && <p role="alert" className="mb-2 text-sm text-rose-600">{error}</p>}
        {target ? (
          <Card title={target.title} action={target.webUrl ? <a className="text-sm underline" href={target.webUrl} target="_blank" rel="noopener noreferrer">Open in Teams</a> : undefined}>
            <ul className="flex flex-col gap-3 text-sm">
              {messages.map((m) => (
                <li key={m.id} className={m.system ? "text-xs text-zinc-500" : ""}>
                  <p>
                    <span className="font-medium">{m.from}</span> <span className="text-xs text-zinc-500">{whenText(m.at)}</span>
                    {m.webUrl && <a className="ml-2 text-xs underline" href={m.webUrl} target="_blank" rel="noopener noreferrer">Teams</a>}
                  </p>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.replies && m.replies.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-2 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
                      {m.replies.map((r) => (
                        <li key={r.id}>
                          <span className="font-medium">{r.from}</span> <span className="text-xs text-zinc-500">{whenText(r.at)}</span>
                          <p className="whitespace-pre-wrap">{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {target.kind === "channel" && !m.system && (
                    <>
                      <button className="mt-1 text-xs underline" onClick={() => setReplyTo(replyTo === m.id ? null : m.id)}>Reply</button>
                      {replyTo === m.id && <TeamsReply target={target} replyTo={m} account={account} onDone={() => openTarget(target)} />}
                    </>
                  )}
                </li>
              ))}
            </ul>
            {target.kind === "chat" && <TeamsReply target={target} account={account} onDone={() => openTarget(target)} />}
          </Card>
        ) : (
          <p className="text-sm text-zinc-500">Pick a chat or channel.</p>
        )}
      </div>
    </div>
  );
}

/* ---- Page ---- */

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">{children}</p>;
}

export function GladiatorScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<"mail" | "teams">("mail");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api<Status>("/api/microsoft/status").then(setStatus, (e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p role="alert" className="text-rose-600">{error}</p>;
  if (!status) return <p className="text-zinc-500">Loading…</p>;
  const account = status.email ?? status.account;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800" data-testid="ms-identity">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Gladiator Microsoft 365</p>
          <p className="text-lg font-semibold">{account}</p>
          <p className="text-sm text-zinc-500">
            {status.connected
              ? `Connected ${ago(status.connectedAt)} · Mail and calendar: read and write, from a preview you confirm · Teams: ${status.teams ? "on" : "not connected"}`
              : "Not connected"}
          </p>
          {status.missing.length > 0 && <p className="text-sm text-rose-600">Missing permissions: {status.missing.join(", ")}. Connect again.</p>}
        </div>
        <div className="flex gap-2">
          {status.keys && !status.connected && <a className={buttonClass} href="/api/microsoft/connect">Connect {status.account}</a>}
          {status.connected && (
            <button
              className={ghostButtonClass}
              onClick={async () => {
                if (!window.confirm("Disconnect Gladiator 365 from Maverick? Nothing in Outlook or Teams changes.")) return;
                await api("/api/microsoft/disconnect", {});
                load();
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </section>
      {!status.database && <Notice>Gladiator 365 needs the online database.</Notice>}
      {!status.connected && <Setup status={status} onSaved={load} />}
      {status.connected && (
        <>
          <nav className="flex gap-2">
            <button className={tab === "mail" ? buttonClass : ghostButtonClass} onClick={() => setTab("mail")}>Mail</button>
            <button className={tab === "teams" ? buttonClass : ghostButtonClass} onClick={() => setTab("teams")}>Teams</button>
          </nav>
          {tab === "mail" ? <Mail account={account} /> : <TeamsPanel status={status} account={account} />}
        </>
      )}
    </div>
  );
}
