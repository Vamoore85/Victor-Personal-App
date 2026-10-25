import { graph, MicrosoftError, status as microsoftStatus } from "@/lib/microsoft";

/*
 * Microsoft Teams for Gladiator's account: the chats Vic is in and the
 * channels of teams he has joined, with replies kept under the message they
 * answer and a link back to Teams. Replies are posted only from a confirmed
 * preview (see write-preview.ts). Delegated access only: Microsoft returns
 * just the chats and channels this user can already see, never other
 * people's private chats. Teams meetings stay on their Outlook calendar
 * events; meeting chats appear here as chats, not as calendar entries.
 */

export type TeamsMessage = {
  id: string;
  from: string;
  at: string;
  text: string;
  webUrl: string;
  replyToId: string | null;
  replies?: TeamsMessage[];
  system?: boolean;
};

type GraphMessage = {
  id: string;
  replyToId?: string | null;
  messageType?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  deletedDateTime?: string | null;
  webUrl?: string | null;
  from?: { user?: { displayName?: string } | null; application?: { displayName?: string } | null } | null;
  body?: { contentType?: string; content?: string };
  replies?: GraphMessage[];
};

/** Teams sends HTML; show it as plain text so nothing in a message can run in Maverick. */
export function plainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<attachment[^>]*><\/attachment>/gi, "[attachment]")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toMessage(m: GraphMessage): TeamsMessage | null {
  if (m.deletedDateTime) return null;
  const text = m.body?.contentType === "html" ? plainText(m.body?.content ?? "") : (m.body?.content ?? "").trim();
  const system = m.messageType !== undefined && m.messageType !== "message";
  if (!text && system) return null;
  return {
    id: m.id,
    from: m.from?.user?.displayName || m.from?.application?.displayName || (system ? "Teams" : "Someone"),
    at: m.createdDateTime ?? "",
    text: text.slice(0, 20_000),
    webUrl: m.webUrl ?? "",
    replyToId: m.replyToId ?? null,
    system,
    ...(m.replies ? { replies: m.replies.map(toMessage).filter((r): r is TeamsMessage => Boolean(r)).sort((a, b) => a.at.localeCompare(b.at)) } : {}),
  };
}

const ID = /^[A-Za-z0-9:@._\-=]{3,300}$/;
const checkId = (v: unknown, what: string) => {
  if (typeof v !== "string" || !ID.test(v)) throw new MicrosoftError(`That ${what} can't be opened.`);
  return v;
};

async function needTeams() {
  const s = await microsoftStatus();
  if (!s.connected) throw new MicrosoftError("Connect Gladiator 365 first.", 409);
  if (!s.teams) throw new MicrosoftError("Teams isn't turned on yet. Press Connect Teams.", 409);
  return s.email ?? "";
}

type GraphChat = {
  id: string;
  topic?: string | null;
  chatType?: string;
  webUrl?: string;
  lastUpdatedDateTime?: string;
  members?: { displayName?: string; email?: string | null }[];
  lastMessagePreview?: { createdDateTime?: string; body?: { content?: string; contentType?: string }; from?: GraphMessage["from"] } | null;
};

export async function listChats() {
  const account = await needTeams();
  const page = await graph<{ value?: GraphChat[] }>(`/me/chats?${new URLSearchParams({ $expand: "members,lastMessagePreview", $top: "50", $orderby: "lastMessagePreview/createdDateTime desc" })}`);
  const me = account.toLowerCase();
  const chats = (page.value ?? []).map((c) => {
    const others = (c.members ?? []).filter((m) => (m.email ?? "").toLowerCase() !== me).map((m) => m.displayName || m.email || "Someone");
    const last = c.lastMessagePreview;
    return {
      id: c.id,
      kind: c.chatType === "meeting" ? "Meeting chat" : c.chatType === "group" ? "Group chat" : "Chat",
      title: c.topic || others.join(", ") || "Chat",
      webUrl: c.webUrl ?? "",
      lastAt: last?.createdDateTime ?? c.lastUpdatedDateTime ?? "",
      lastFrom: last?.from?.user?.displayName ?? "",
      lastText: last?.body ? (last.body.contentType === "html" ? plainText(last.body.content ?? "") : (last.body.content ?? "")).slice(0, 200) : "",
    };
  });
  return { account, chats };
}

export async function chatMessages(chatId: unknown) {
  const account = await needTeams();
  const id = checkId(chatId, "chat");
  const page = await graph<{ value?: GraphMessage[] }>(`/chats/${encodeURIComponent(id)}/messages?$top=50`);
  const messages = (page.value ?? []).map(toMessage).filter((m): m is TeamsMessage => Boolean(m)).sort((a, b) => a.at.localeCompare(b.at));
  return { account, chatId: id, messages };
}

export async function listChannels() {
  const account = await needTeams();
  const teams = await graph<{ value?: { id: string; displayName?: string }[] }>("/me/joinedTeams?$select=id,displayName");
  const out: { teamId: string; team: string; channels: { id: string; name: string; webUrl: string }[] }[] = [];
  for (const t of teams.value ?? []) {
    const ch = await graph<{ value?: { id: string; displayName?: string; webUrl?: string }[] }>(`/teams/${encodeURIComponent(t.id)}/channels?$select=id,displayName,webUrl`).catch(() => ({ value: [] }));
    out.push({ teamId: t.id, team: t.displayName ?? "Team", channels: (ch.value ?? []).map((c) => ({ id: c.id, name: c.displayName ?? "Channel", webUrl: c.webUrl ?? "" })) });
  }
  return { account, teams: out };
}

/** Channel posts with their replies under them. */
export async function channelMessages(teamId: unknown, channelId: unknown) {
  const account = await needTeams();
  const t = checkId(teamId, "team");
  const c = checkId(channelId, "channel");
  const page = await graph<{ value?: GraphMessage[] }>(`/teams/${encodeURIComponent(t)}/channels/${encodeURIComponent(c)}/messages?$top=25&$expand=replies`);
  const messages = (page.value ?? []).map(toMessage).filter((m): m is TeamsMessage => Boolean(m)).sort((a, b) => b.at.localeCompare(a.at));
  return { account, teamId: t, channelId: c, messages };
}

/* ---- Writing ---- */

export type TeamsPost = { kind: "chat" | "channel"; chatId: string; teamId: string; channelId: string; replyTo: string; text: string };

export function checkPost(raw: unknown): TeamsPost {
  const d = (raw ?? {}) as Record<string, unknown>;
  const kind = d.kind === "channel" ? "channel" : "chat";
  const text = typeof d.text === "string" ? d.text.replace(/\r\n/g, "\n").trim().slice(0, 20_000) : "";
  if (!text) throw new MicrosoftError("Write the message.");
  if (kind === "chat") return { kind, chatId: checkId(d.chatId, "chat"), teamId: "", channelId: "", replyTo: "", text };
  return { kind, chatId: "", teamId: checkId(d.teamId, "team"), channelId: checkId(d.channelId, "channel"), replyTo: checkId(d.replyTo, "message"), text };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");

/** Posts as Vic. Call only after checkPreview. */
export async function postMessage(p: TeamsPost) {
  await needTeams();
  const body = JSON.stringify({ body: { contentType: "html", content: escapeHtml(p.text) } });
  const path = p.kind === "chat" ? `/chats/${encodeURIComponent(p.chatId)}/messages` : `/teams/${encodeURIComponent(p.teamId)}/channels/${encodeURIComponent(p.channelId)}/messages/${encodeURIComponent(p.replyTo)}/replies`;
  const made = await graph<{ id?: string; webUrl?: string }>(path, { method: "POST", body });
  return { ok: true, webUrl: made.webUrl ?? "" };
}
