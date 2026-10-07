"use client";

import { useAuth, useRevokeSession, useSession } from "@better-auth-ui/react";
import type { Session } from "better-auth";
import Bowser from "bowser";
import { LogOut, Monitor, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { FromNowHoverCard } from "@/components/from-now-card";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

export type ActiveSessionProps = {
  activeSession: Session;
};

/** Render a single active session row with device info and revoke control. */
export function ActiveSession({ activeSession }: ActiveSessionProps) {
  const { authClient, basePaths, localization, viewPaths, navigate } =
    useAuth();
  const { data: session } = useSession(authClient, { refetchOnMount: false });

  const { mutate: revokeSession, isPending: isRevoking } = useRevokeSession(
    authClient,
    {
      onSuccess: () =>
        toast.success(localization.settings.revokeSessionSuccess),
    },
  );

  const isCurrentSession = activeSession.token === session?.session.token;
  const ua = Bowser.parse(activeSession.userAgent || "");
  const isMobile =
    ua.platform.type === "mobile" || ua.platform.type === "tablet";

  return (
    <Item>
      <ItemMedia variant="icon">
        {isMobile ? <Smartphone /> : <Monitor />}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {ua.browser.name || "Unknown Browser"}
          {ua.os.name ? `, ${ua.os.name}` : ""}
        </ItemTitle>
        {isCurrentSession ? (
          <Badge variant="secondary">
            {localization.settings.currentSession}
          </Badge>
        ) : (
          activeSession.createdAt && (
            <ItemDescription>
              <FromNowHoverCard date={activeSession.createdAt} />
            </ItemDescription>
          )
        )}
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            isCurrentSession
              ? navigate({
                  to: `${basePaths.auth}/${viewPaths.auth.signOut}`,
                })
              : revokeSession(activeSession)
          }
          disabled={isRevoking}
          aria-label={
            isCurrentSession
              ? localization.auth.signOut
              : localization.settings.revokeSession
          }
        >
          {isRevoking ? <Spinner /> : isCurrentSession ? <LogOut /> : <X />}

          {isCurrentSession
            ? localization.auth.signOut
            : localization.settings.revoke}
        </Button>
      </ItemActions>
    </Item>
  );
}
