import type { Metadata } from "next";

import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Authorize application" };

/** GitHub's authorize page path. The API checked the app and its callback before the oauth-provider plugin sent the user here. */
export default async function AuthorizePage({
  searchParams,
}: PageProps<"/login/oauth/authorize">) {
  const { client_id: clientId, scope } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center p-4 md:p-6 w-full container">
      <ConsentForm
        clientId={typeof clientId === "string" ? clientId : ""}
        scope={typeof scope === "string" ? scope : ""}
      />
    </div>
  );
}
