"use client";

import { AppWindow } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { ScopeList } from "@/components/oauth-apps/scope-list";
import { useSaveSettings } from "@/components/organizations/organization-policies";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "@/components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import type { components } from "@/lib/api/v1";

type Answer = components["schemas"]["OauthAppAccessDTO"];

const STATE_LABELS: Record<Answer["state"], string> = {
  requested: "Requested",
  approved: "Approved",
  denied: "Denied",
};

/** The organization's OAuth app access restrictions: the switch, and the apps members asked for with the admins' answers. */
export function OauthAppAccessSettings({
  slug,
  restricted,
  apps,
}: {
  slug: string;
  restricted: boolean;
  apps: Answer[];
}) {
  const { save, saving } = useSaveSettings(slug);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">OAuth app access</h2>
        <Card className="px-6 py-5">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Restrict OAuth apps</FieldTitle>
              <FieldDescription>
                An app a member authorizes reaches this organization&apos;s
                repositories only once an admin approves it. gh and the
                organization&apos;s own apps are always allowed; tokens made in
                Ghost are not affected.
              </FieldDescription>
            </FieldContent>
            <Switch
              aria-label="Restrict OAuth apps"
              checked={restricted}
              disabled={saving}
              onCheckedChange={(checked) =>
                save(
                  { oauthAppRestrictions: checked },
                  checked
                    ? "OAuth apps now need approval"
                    : "OAuth apps are no longer restricted",
                )
              }
            />
          </Field>
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Requests and answers</h2>
          <p className="text-sm text-muted-foreground">
            {restricted
              ? "Approve an app to let it in; revoke an answer to start over."
              : "These apply once restrictions are on."}
          </p>
        </div>
        <Card className="py-0">
          {apps.length === 0 ? (
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <AppWindow />
                </EmptyMedia>
                <EmptyTitle>No requests yet</EmptyTitle>
                <EmptyDescription>
                  Members ask for an app when they authorize it, or from their
                  authorized apps.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-0!">
              {apps.map((app, index) => (
                <Fragment key={app.clientId}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <AnswerRow slug={slug} app={app} />
                </Fragment>
              ))}
            </ItemGroup>
          )}
        </Card>
      </section>
    </div>
  );
}

function AnswerRow({ slug, app }: { slug: string; app: Answer }) {
  const router = useRouter();
  const [pending, setPending] = useState<"approved" | "denied" | "revoke">();
  const path = { params: { path: { slug, clientId: app.clientId } } };
  const act = async (action: "approved" | "denied" | "revoke") => {
    setPending(action);
    const { error } =
      action === "revoke"
        ? await apiClient.DELETE(
            "/api/organizations/{slug}/oauth-app-access/{clientId}",
            path,
          )
        : await apiClient.PUT(
            "/api/organizations/{slug}/oauth-app-access/{clientId}",
            { ...path, body: { state: action } },
          );
    setPending(undefined);
    if (error) return toast.error(apiErrorMessage(error));
    router.refresh();
  };

  return (
    <Item className="flex-wrap items-start">
      <ItemMedia>
        <ProfileAvatar
          name={app.name}
          image={app.logoUrl}
          className="size-10 rounded-lg"
        />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1">
        <ItemTitle>
          {app.name}
          <Badge variant={app.state === "approved" ? "default" : "secondary"}>
            {STATE_LABELS[app.state]}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {app.requestedBy
            ? `Requested by ${app.requestedBy} on ${new Date(app.requestedAt).toLocaleDateString()}`
            : "Not requested"}
          {app.decidedBy && app.decidedAt
            ? ` · ${STATE_LABELS[app.state].toLowerCase()} by ${app.decidedBy} on ${new Date(app.decidedAt).toLocaleDateString()}`
            : ""}
        </ItemDescription>
        <p className="text-sm text-muted-foreground">
          {app.owner ? `By @${app.owner}` : "Built into Ghost"}
          {app.homepageUrl && (
            <>
              {" · "}
              <a
                href={app.homepageUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {new URL(app.homepageUrl).host}
              </a>
            </>
          )}
        </p>
        {app.description && (
          <p className="text-sm text-pretty">{app.description}</p>
        )}
        <Accordion type="single" collapsible className="mt-1.5">
          <AccordionItem value="permissions">
            <AccordionTrigger className="flex-none items-center justify-start gap-1 py-0.5 font-normal text-muted-foreground hover:text-foreground hover:no-underline **:data-[slot=accordion-trigger-icon]:size-3.5">
              What it can do here
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-3 pt-1.5">
              <p className="text-sm text-muted-foreground">
                Everything members of this organization have let it do.
                Approving it lets it use these on the organization&apos;s
                repositories, including scopes members grant it later.
              </p>
              <ScopeList
                scopes={app.scopes}
                className="ml-1.5 border-l pb-1 pl-4"
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </ItemContent>
      <ItemActions>
        {app.state !== "approved" && (
          <Button
            size="sm"
            disabled={pending !== undefined}
            onClick={() => act("approved")}
          >
            {pending === "approved" && <Spinner />}
            Approve
          </Button>
        )}
        {app.state === "requested" && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== undefined}
            onClick={() => act("denied")}
          >
            {pending === "denied" && <Spinner />}
            Deny
          </Button>
        )}
        {app.state !== "requested" && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== undefined}
            onClick={() => act("revoke")}
          >
            {pending === "revoke" && <Spinner />}
            Revoke
          </Button>
        )}
      </ItemActions>
    </Item>
  );
}

export function OauthAppAccessSettingsSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </section>
      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
        <ul className="divide-y rounded-lg border">
          {Array.from({ length: 2 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-lg" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3.5 w-56" />
              </div>
              <Skeleton className="h-8 w-20" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
