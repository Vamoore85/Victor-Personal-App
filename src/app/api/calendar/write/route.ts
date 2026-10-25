import { CalendarError, cancelEvent, checkDraft, createEvent, updateEvent } from "@/lib/calendar";
import { status } from "@/lib/microsoft";
import { checkPreview, previewToken } from "@/lib/write-preview";
import { handle } from "../../microsoft/handle";

// Changes to Gladiator's Outlook calendar. Each one needs the token from a matching preview.
export const POST = handle(async (body) => {
  const s = await status();
  if (!s.connected || !s.email) throw new CalendarError("Connect Gladiator 365 first.", 409);
  const account = s.email;
  const kind = body.kind === "update" ? "update" : body.kind === "cancel" ? "cancel" : "create";
  const payload =
    kind === "cancel"
      ? { account, kind, calendarId: String(body.calendarId ?? ""), eventId: String(body.eventId ?? ""), comment: typeof body.comment === "string" ? body.comment.slice(0, 1000) : "" }
      : { account, kind, eventId: kind === "update" ? String(body.eventId ?? "") : "", draft: checkDraft(body.draft) };
  if (body.action === "preview") return { account, payload, token: previewToken("calendar", payload) };
  if (body.action !== "commit") throw new CalendarError("Nothing to do.");
  if (!checkPreview("calendar", payload, body.token)) throw new CalendarError("This changed since its preview, or the preview expired. Preview it again.", 409);
  if (payload.kind === "cancel") return cancelEvent(payload.calendarId, payload.eventId, payload.comment);
  if (payload.kind === "update") return updateEvent(payload.eventId, payload.draft);
  return createEvent(payload.draft);
});
