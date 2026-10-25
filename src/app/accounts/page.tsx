import { redirect } from "next/navigation";

export default function AccountsRoute() {
  redirect("/money?tab=accounts");
}
