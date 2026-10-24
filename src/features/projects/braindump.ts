/*
 * Brain Dump: thoughts land in an inbox as they are (typed, a pasted link, or
 * spoken), then get sorted into a project, a task, a research item or
 * someday/later, with tags and, if you like, the company it's for.
 */

export type Kind = "inbox" | "project" | "task" | "research" | "someday";
export type Entity = "personal" | "business" | "gladiator";
export type Source = "typed" | "link" | "voice";

export type Thought = {
  id: string;
  text: string;
  source: Source;
  kind: Kind;
  tags: string[];
  entity?: Entity;
  done?: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean; // kept as a marker so another device's copy can't bring it back
};

export type BrainDump = { thoughts: Thought[] };
export const EMPTY: BrainDump = { thoughts: [] };

export const KINDS: { id: Exclude<Kind, "inbox">; label: string; hint: string }[] = [
  { id: "project", label: "Project", hint: "Something with several steps" },
  { id: "task", label: "Task", hint: "One next action" },
  { id: "research", label: "Research", hint: "Look into it" },
  { id: "someday", label: "Someday", hint: "Not now, maybe later" },
];
export const ENTITIES: { id: Entity; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "business", label: "Maverick" },
  { id: "gladiator", label: "Gladiator" },
];

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;
export const tagsIn = (text: string) => [...new Set((text.match(/#[\p{L}\d_-]+/gu) ?? []).map((t) => t.slice(1).toLowerCase()))];
export const linksIn = (text: string) => text.match(/https?:\/\/[^\s)]+/gi) ?? [];

export function newThought(text: string, source: Source, id: string, now = new Date().toISOString()): Thought {
  const t = text.trim();
  return { id, text: t, source: source === "typed" && URL_ONLY.test(t) ? "link" : source, kind: "inbox", tags: tagsIn(t), createdAt: now, updatedAt: now };
}

export function update(d: BrainDump, id: string, patch: Partial<Thought>, now = new Date().toISOString()): BrainDump {
  return { thoughts: d.thoughts.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now } : t)) };
}

export const visible = (d: BrainDump) => d.thoughts.filter((t) => !t.deleted);

export function normalize(raw: unknown): BrainDump {
  const v = raw as { thoughts?: unknown } | null;
  if (!v || !Array.isArray(v.thoughts)) return EMPTY;
  return {
    thoughts: (v.thoughts as Thought[])
      .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
      .map((t) => ({ ...t, tags: Array.isArray(t.tags) ? t.tags : [], kind: t.kind ?? "inbox", source: t.source ?? "typed" })),
  };
}

/** Two copies (this device and another) combined: every thought kept, the newer edit of each wins. */
export function merge(mine: BrainDump, theirs: BrainDump): BrainDump {
  const by = new Map<string, Thought>();
  for (const t of [...theirs.thoughts, ...mine.thoughts]) {
    const have = by.get(t.id);
    if (!have || t.updatedAt >= have.updatedAt) by.set(t.id, t);
  }
  return { thoughts: [...by.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
