"use client";

import type { SettingsView } from "@better-auth-ui/core";
import { useAuth } from "@better-auth-ui/react";

import { GHOST_SETTINGS_PATHS } from "@/lib/auth/settings-paths";
import { useAuthenticate } from "@/lib/auth/use-authenticate";
import { AppWindow, HardDrive, KeyRound, Shield, User2 } from "lucide-react";
import { useMemo } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AccountSettings } from "./account/account-settings";
import { AuthorizedAppsSettings } from "./authorized-apps/authorized-apps-settings";
import { OauthAppsSettings } from "./oauth-apps/oauth-apps-settings";
import { SecuritySettings } from "./security/security-settings";
import { StorageSettings } from "./storage/storage-settings";

export type SettingsProps = {
  className?: string;
  path?: string;
  view?: SettingsView;
  hideNav?: boolean;
};

export function Settings({ className, view, path, hideNav }: SettingsProps) {
  const { authClient, basePaths, localization, viewPaths, plugins, navigate } =
    useAuth();
  useAuthenticate(authClient);

  if (!view && !path) {
    throw new Error(
      "[Better Auth UI] Either `view` or `path` must be provided",
    );
  }

  const currentView = useMemo(() => {
    if (view) return view;
    if (!path) return undefined;
    if ((GHOST_SETTINGS_PATHS as readonly string[]).includes(path))
      return path as SettingsView;

    const match = [
      viewPaths.settings,
      ...plugins.map((plugin) => plugin.viewPaths?.settings),
    ]
      .flatMap((source) => Object.entries(source ?? {}))
      .find(([, segment]) => segment === path);

    return match?.[0] as SettingsView | undefined;
  }, [view, path, viewPaths.settings, plugins]);

  if (!currentView) {
    const validPaths = [
      viewPaths.settings,
      ...plugins.map((plugin) => plugin.viewPaths?.settings),
    ]
      .flatMap((source) => Object.values(source ?? {}))
      .join(", ");
    throw new Error(
      `[Better Auth UI] Unknown settings path "${path}". Valid paths are: ${validPaths}`,
    );
  }

  return (
    <Tabs
      value={currentView}
      className={cn("w-full gap-4 md:gap-6", className)}
    >
      <div className={cn(hideNav && "hidden")}>
        <TabsList aria-label={localization.settings.settings}>
          <TabsTrigger
            value="account"
            className="gap-1"
            onClick={() =>
              navigate({
                to: `${basePaths.settings}/${viewPaths.settings.account}`,
              })
            }
          >
            <User2 className="text-muted-foreground" />

            {localization.settings.account}
          </TabsTrigger>

          <TabsTrigger
            value="security"
            className="gap-1"
            onClick={() =>
              navigate({
                to: `${basePaths.settings}/${viewPaths.settings.security}`,
              })
            }
          >
            <Shield className="text-muted-foreground" />

            {localization.settings.security}
          </TabsTrigger>

          <TabsTrigger
            value="storage"
            className="gap-1"
            onClick={() => navigate({ to: `${basePaths.settings}/storage` })}
          >
            <HardDrive className="text-muted-foreground" />
            Storage
          </TabsTrigger>

          <TabsTrigger
            value="oauth-apps"
            className="gap-1"
            onClick={() => navigate({ to: `${basePaths.settings}/oauth-apps` })}
          >
            <AppWindow className="text-muted-foreground" />
            OAuth apps
          </TabsTrigger>

          <TabsTrigger
            value="authorized-apps"
            className="gap-1"
            onClick={() =>
              navigate({ to: `${basePaths.settings}/authorized-apps` })
            }
          >
            <KeyRound className="text-muted-foreground" />
            Authorized apps
          </TabsTrigger>

          {plugins.flatMap(
            (plugin) =>
              plugin.settingsTabs?.map((settingsTab) => (
                <TabsTrigger
                  key={`${plugin.id}-${settingsTab.view}`}
                  value={settingsTab.view}
                  className="gap-1"
                  onClick={() =>
                    navigate({
                      to: `${basePaths.settings}/${plugin.viewPaths?.settings?.[settingsTab.view]}`,
                    })
                  }
                >
                  {settingsTab.label}
                </TabsTrigger>
              )) ?? [],
          )}
        </TabsList>
      </div>

      <TabsContent value="account" tabIndex={-1}>
        <AccountSettings />
      </TabsContent>

      <TabsContent value="security" tabIndex={-1}>
        <SecuritySettings />
      </TabsContent>

      <TabsContent value="storage" tabIndex={-1}>
        <StorageSettings />
      </TabsContent>

      <TabsContent value="oauth-apps" tabIndex={-1}>
        <OauthAppsSettings />
      </TabsContent>

      <TabsContent value="authorized-apps" tabIndex={-1}>
        <AuthorizedAppsSettings />
      </TabsContent>

      {plugins.flatMap((plugin) =>
        plugin.settingsTabs?.map((settingsTab) => (
          <TabsContent
            key={`${plugin.id}-${settingsTab.view}`}
            value={settingsTab.view}
            tabIndex={-1}
          >
            <settingsTab.component />
          </TabsContent>
        )),
      )}
    </Tabs>
  );
}
