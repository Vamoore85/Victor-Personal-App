import { channelMessages, chatMessages, checkPost, listChannels, listChats, postMessage } from "@/lib/teams";
import { MicrosoftError, status } from "@/lib/microsoft";
import { checkPreview, previewToken } from "@/lib/write-preview";
import { handle } from "../handle";

// Gladiator Teams. "post" only works with the token from a matching "preview".
export const POST = handle(async (body) => {
  switch (body.action) {
    case "chats":
      return listChats();
    case "chat":
      return chatMessages(body.chatId);
    case "channels":
      return listChannels();
    case "channel":
      return channelMessages(body.teamId, body.channelId);
    case "preview": {
      const post = checkPost(body.post);
      const s = await status();
      if (!s.connected || !s.teams) throw new MicrosoftError("Teams isn't connected.", 409);
      return { from: s.email, post, token: previewToken("teams", { from: s.email, post }) };
    }
    case "post": {
      const post = checkPost(body.post);
      const s = await status();
      if (!checkPreview("teams", { from: s.email, post }, body.token)) throw new MicrosoftError("This changed since its preview, or the preview expired. Preview it again.", 409);
      return { from: s.email, ...(await postMessage(post)) };
    }
    default:
      throw new MicrosoftError("Nothing to do.");
  }
});
