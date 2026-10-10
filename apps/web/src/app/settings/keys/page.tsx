import { GpgKeys } from "@/components/auth/settings/security/gpg-keys";
import { SshKeys } from "@/components/auth/settings/security/ssh-keys";

export default function KeysSettingsPage() {
  return (
    <div className="flex w-full flex-col gap-4 md:gap-6">
      <SshKeys />
      <GpgKeys />
    </div>
  );
}
