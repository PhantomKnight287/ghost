import { ChangeEmail } from "./change-email";
import { EmailAddresses } from "./email-addresses";
import { UserProfile } from "./user-profile";

/** Renders the account settings layout. */
export function AccountSettings() {
  return (
    <div className="flex w-full flex-col gap-4 md:gap-6">
      <UserProfile />
      <ChangeEmail />
      <EmailAddresses />
    </div>
  );
}
