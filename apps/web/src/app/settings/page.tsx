import { viewPaths } from "@better-auth-ui/core";
import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect(`/settings/${viewPaths.settings.account}`);
}
