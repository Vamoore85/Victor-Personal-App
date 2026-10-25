import { listMail, mailPreview, readMessage, sendMail, checkCompose } from "@/lib/outlook-mail";
import { MicrosoftError } from "@/lib/microsoft";
import { checkPreview, previewToken } from "@/lib/write-preview";
import { handle } from "../handle";

// One endpoint for Gladiator mail. "send" and "draft" only work with the token from a matching "preview".
export const POST = handle(async (body) => {
  switch (body.action) {
    case "list":
      return listMail({ folder: body.folder, search: body.search, next: body.next });
    case "read":
      return readMessage(body.id);
    case "preview": {
      const p = await mailPreview(body.compose);
      return { ...p, token: previewToken("mail", { from: p.from, compose: p.compose }) };
    }
    case "send":
    case "draft": {
      const compose = checkCompose(body.compose);
      const p = await mailPreview(compose);
      if (!checkPreview("mail", { from: p.from, compose: p.compose }, body.token)) throw new MicrosoftError("This changed since its preview, or the preview expired. Preview it again.", 409);
      return { from: p.from, ...(await sendMail(compose, body.action === "draft")) };
    }
    default:
      throw new MicrosoftError("Nothing to do.");
  }
});
