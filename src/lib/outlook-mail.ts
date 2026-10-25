import { graph, GRAPH, MicrosoftError, status as microsoftStatus } from "@/lib/microsoft";

/*
 * Gladiator's Outlook mailbox (vic@gladiatoremergence.com): read, search,
 * save drafts, send and reply. Every send or draft starts from a preview the
 * owner confirms (see write-preview.ts). Nothing deletes or moves mail, and
 * nothing here runs on a schedule. Message bodies are fetched only when the
 * owner opens a message, and aren't stored.
 */

export type Person = { name: string; address: string };
export type MailSummary = {
  id: string;
  conversationId: string;
  subject: string;
  from: Person | null;
  to: Person[];
  received: string;
  preview: string;
  isRead: boolean;
  hasAttachments: boolean;
  webLink: string;
};
export type MailMessage = MailSummary & { cc: Person[]; body: string };

export const FOLDERS = { inbox: "inbox", sent: "sentitems", drafts: "drafts" } as const;
export type Folder = keyof typeof FOLDERS;

type GraphAddress = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  bodyPreview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  body?: { contentType?: string; content?: string };
};

const SUMMARY_FIELDS = "id,conversationId,subject,from,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,webLink";

const person = (a?: GraphAddress): Person | null => (a?.emailAddress?.address ? { name: a.emailAddress.name ?? "", address: a.emailAddress.address } : null);
const people = (list?: GraphAddress[]) => (list ?? []).map(person).filter((p): p is Person => Boolean(p));

export function summarize(m: GraphMessage): MailSummary {
  return {
    id: m.id,
    conversationId: m.conversationId ?? "",
    subject: m.subject?.trim() || "(No subject)",
    from: person(m.from),
    to: people(m.toRecipients),
    received: m.receivedDateTime ?? m.sentDateTime ?? "",
    preview: m.bodyPreview ?? "",
    isRead: Boolean(m.isRead),
    hasAttachments: Boolean(m.hasAttachments),
    webLink: m.webLink ?? "",
  };
}

/** Microsoft's search syntax: keep it to words, quotes and simple operators, no injected parameters. */
export function cleanSearch(q: unknown) {
  return typeof q === "string" ? q.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

/** A next-page link is only followed if it's Microsoft Graph's own link back into this mailbox. */
export function safeNextLink(link: unknown) {
  return typeof link === "string" && link.startsWith(`${GRAPH}/me/`) ? link : null;
}

export async function listMail(opts: { folder?: unknown; search?: unknown; next?: unknown }) {
  const s = await microsoftStatus();
  if (!s.connected) throw new MicrosoftError("Connect Gladiator 365 first.", 409);
  const next = safeNextLink(opts.next);
  const folder: Folder = opts.folder === "sent" || opts.folder === "drafts" ? opts.folder : "inbox";
  const search = cleanSearch(opts.search);
  let path: string;
  if (next) path = next;
  else if (search) path = `/me/messages?${new URLSearchParams({ $search: `"${search}"`, $select: SUMMARY_FIELDS, $top: "25" })}`;
  else path = `/me/mailFolders/${FOLDERS[folder]}/messages?${new URLSearchParams({ $select: SUMMARY_FIELDS, $orderby: "receivedDateTime desc", $top: "25" })}`;
  const page = await graph<{ value?: GraphMessage[]; "@odata.nextLink"?: string }>(path, search ? { headers: { ConsistencyLevel: "eventual" } } : {});
  return { account: s.email, folder, search, messages: (page.value ?? []).map(summarize), next: safeNextLink(page["@odata.nextLink"]) };
}

const ID = /^[A-Za-z0-9=_\-+/]{10,512}$/;
export const validId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

/** One message, as plain text, with the rest of its conversation listed. */
export async function readMessage(id: unknown) {
  if (!validId(id)) throw new MicrosoftError("That message can't be opened.");
  const s = await microsoftStatus();
  if (!s.connected) throw new MicrosoftError("Connect Gladiator 365 first.", 409);
  const m = await graph<GraphMessage>(`/me/messages/${encodeURIComponent(id)}?$select=${SUMMARY_FIELDS},ccRecipients,body`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
  let thread: MailSummary[] = [];
  if (m.conversationId) {
    const conv = await graph<{ value?: GraphMessage[] }>(
      `/me/messages?${new URLSearchParams({ $filter: `conversationId eq '${m.conversationId.replace(/'/g, "''")}'`, $select: SUMMARY_FIELDS, $top: "50" })}`,
    ).catch(() => ({ value: [] }));
    thread = (conv.value ?? []).map(summarize).sort((a, b) => a.received.localeCompare(b.received));
  }
  const message: MailMessage = { ...summarize(m), cc: people(m.ccRecipients), body: (m.body?.content ?? "").slice(0, 100_000) };
  return { account: s.email, message, thread };
}

/* ---- Writing ---- */

export type Compose = {
  mode: "new" | "reply" | "replyAll";
  replyTo: string; // message id for replies, "" for new
  to: string[];
  cc: string[];
  subject: string;
  body: string; // plain text
};

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;

function addresses(v: unknown) {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/) : [];
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

export function checkCompose(raw: unknown): Compose {
  const d = (raw ?? {}) as Record<string, unknown>;
  const mode = d.mode === "reply" || d.mode === "replyAll" ? d.mode : "new";
  const c: Compose = {
    mode,
    replyTo: mode === "new" ? "" : String(d.replyTo ?? ""),
    to: addresses(d.to),
    cc: addresses(d.cc),
    subject: typeof d.subject === "string" ? d.subject.trim().slice(0, 255) : "",
    body: typeof d.body === "string" ? d.body.replace(/\r\n/g, "\n").slice(0, 50_000) : "",
  };
  const bad = [...c.to, ...c.cc].find((a) => !EMAIL.test(a));
  if (bad) throw new MicrosoftError(`"${bad}" isn't an email address.`);
  if (c.to.length + c.cc.length > 50) throw new MicrosoftError("That's more than 50 recipients.");
  if (mode !== "new" && !validId(c.replyTo)) throw new MicrosoftError("Pick the message to reply to.");
  if (mode === "new" && !c.to.length) throw new MicrosoftError("Add who it's to.");
  if (mode === "new" && !c.subject) throw new MicrosoftError("Add a subject.");
  if (!c.body.trim()) throw new MicrosoftError("Write the message.");
  return c;
}

const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

/** What the owner sees before sending: the mailbox it comes from and exactly who gets it. */
export async function mailPreview(raw: unknown) {
  const c = checkCompose(raw);
  const s = await microsoftStatus();
  if (!s.connected || !s.email) throw new MicrosoftError("Connect Gladiator 365 first.", 409);
  let to = c.to;
  let cc = c.cc;
  let subject = c.subject;
  if (c.mode !== "new") {
    // Replies go to the people Microsoft will reply to, plus anyone added.
    const m = await graph<GraphMessage>(`/me/messages/${encodeURIComponent(c.replyTo)}?$select=subject,from,toRecipients,ccRecipients`);
    const self = s.email.toLowerCase();
    const sender = person(m.from)?.address.toLowerCase();
    const replyPeople = c.mode === "replyAll" ? [sender, ...people(m.toRecipients).map((p) => p.address.toLowerCase())] : [sender];
    to = [...new Set([...replyPeople.filter((a): a is string => Boolean(a) && a !== self), ...c.to])];
    cc = c.mode === "replyAll" ? [...new Set([...people(m.ccRecipients).map((p) => p.address.toLowerCase()).filter((a) => a !== self), ...c.cc])] : c.cc;
    subject = /^re:/i.test(m.subject ?? "") ? (m.subject ?? "") : `RE: ${m.subject ?? ""}`;
  }
  return { from: s.email, compose: c, to, cc, subject };
}

/** Sends, or saves as a draft in Gladiator's Drafts folder. Call only after checkPreview. */
export async function sendMail(c: Compose, draftOnly: boolean) {
  if (c.mode === "new") {
    const message = { subject: c.subject, body: { contentType: "Text", content: c.body }, toRecipients: recipients(c.to), ccRecipients: recipients(c.cc) };
    if (draftOnly) {
      const d = await graph<{ id: string; webLink?: string }>("/me/messages", { method: "POST", body: JSON.stringify(message) });
      return { draft: true, webLink: d.webLink ?? "" };
    }
    await graph("/me/sendMail", { method: "POST", body: JSON.stringify({ message, saveToSentItems: true }) });
    return { sent: true };
  }
  // Reply: Microsoft builds the quoted thread and the recipients; add anyone extra, then send or keep.
  const action = c.mode === "replyAll" ? "createReplyAll" : "createReply";
  const draft = await graph<{ id: string; webLink?: string; toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[] }>(`/me/messages/${encodeURIComponent(c.replyTo)}/${action}`, {
    method: "POST",
    body: JSON.stringify({ comment: c.body }),
  });
  if (c.to.length || c.cc.length) {
    const to = [...new Set([...people(draft.toRecipients).map((p) => p.address.toLowerCase()), ...c.to])];
    const cc = [...new Set([...people(draft.ccRecipients).map((p) => p.address.toLowerCase()), ...c.cc])];
    await graph(`/me/messages/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: JSON.stringify({ toRecipients: recipients(to), ccRecipients: recipients(cc) }) });
  }
  if (draftOnly) return { draft: true, webLink: draft.webLink ?? "" };
  await graph(`/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
  return { sent: true };
}
