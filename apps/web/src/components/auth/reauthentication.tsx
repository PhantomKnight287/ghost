"use client";

import { getReauthenticationSignInURL } from "@better-auth-ui/core";
import { useAuth, useSignOut } from "@better-auth-ui/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type ReauthenticationActionProps = {
  className?: string;
  showTitle?: boolean;
};

export function ReauthenticationAction({
  className,
  showTitle = true,
}: ReauthenticationActionProps) {
  const auth = useAuth();
  const signOut = useSignOut(auth.authClient);

  const handleReauthentication = () => {
    const signInURL = getReauthenticationSignInURL(
      new URL(window.location.href),
      `${auth.basePaths.auth}/${auth.viewPaths.auth.signIn}`,
    );
    signOut.mutate(undefined, {
      onSuccess: () => auth.navigate({ to: signInURL }),
    });
  };

  return (
    <div className={cn("flex flex-col items-start gap-3 p-4", className)}>
      <div className="flex flex-col gap-1">
        {showTitle ? (
          <h3 className="text-sm font-medium">
            {auth.localization.settings.reauthenticationTitle}
          </h3>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {auth.localization.settings.reauthenticationDescription}
        </p>
      </div>
      <Button
        disabled={signOut.isPending}
        onClick={handleReauthentication}
        size="sm"
      >
        {signOut.isPending ? <Spinner data-icon="inline-start" /> : null}
        {auth.localization.settings.reauthenticationAction}
      </Button>
    </div>
  );
}
