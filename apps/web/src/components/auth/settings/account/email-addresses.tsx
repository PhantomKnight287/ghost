"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export type EmailAddressesProps = {
  className?: string;
};

type UserEmail = {
  id: string;
  email: string;
  verified: boolean;
  primary: boolean;
};

const QUERY_KEY = ["emails"];

/**
 * Manage the addresses an account owns beyond the one it signs in with.
 *
 * Adding one mails it a link; until that link is followed the address counts for nothing, which is why unverified rows say so and offer no actions.
 */
export function EmailAddresses({ className }: EmailAddressesProps) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  useVerificationResult();

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/emails");
      if (error) throw new Error(apiErrorMessage(error));
      return data.emails as UserEmail[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const add = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await apiClient.POST("/api/emails", {
        body: { email: value },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async (_result, value) => {
      setEmail("");
      toast.success(`Verification email sent to ${value}`);
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resend = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.POST("/api/emails/{id}/resend", {
        params: { path: { id } },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: () => toast.success("Verification email sent again"),
    onError: (error: Error) => toast.error(error.message),
  });

  const makePrimary = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.POST("/api/emails/{id}/primary", {
        params: { path: { id } },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async () => {
      toast.success("Primary address updated");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE("/api/emails/{id}", {
        params: { path: { id } },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async () => {
      toast.success("Address removed");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isBusy =
    add.isPending ||
    resend.isPending ||
    makePrimary.isPending ||
    remove.isPending;
  const emails = data ?? [];

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Email addresses</h2>

      <TooltipProvider>
        <Card className={cn("gap-0 p-0", className)}>
          <CardContent className="p-0">
            <ItemGroup className="gap-0!">
              {isPending ? (
                <EmailRowSkeleton />
              ) : (
                emails.map((entry, index) => (
                  <Fragment key={entry.id}>
                    {index > 0 && <ItemSeparator className="my-0!" />}
                    <Item>
                      <ItemMedia variant="icon">
                        <Mail />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{entry.email}</ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        {entry.verified ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <CircleCheck
                                aria-label="Verified"
                                className="size-4 text-emerald-500"
                              />
                            </TooltipTrigger>
                            <TooltipContent>Verified address</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant="outline">Unverified</Badge>
                        )}
                        {entry.primary && (
                          <Badge variant="secondary">Primary</Badge>
                        )}
                        {!entry.verified && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => resend.mutate(entry.id)}
                          >
                            Resend
                          </Button>
                        )}
                        {!entry.primary && entry.verified && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() => makePrimary.mutate(entry.id)}
                          >
                            Make primary
                          </Button>
                        )}
                        {!entry.primary && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isBusy}
                            onClick={() => remove.mutate(entry.id)}
                          >
                            Remove
                          </Button>
                        )}
                      </ItemActions>
                    </Item>
                  </Fragment>
                ))
              )}
            </ItemGroup>
          </CardContent>

          <form
            className="flex flex-wrap items-center justify-end gap-2 border-t p-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim()) add.mutate(email.trim());
            }}
          >
            <Input
              type="email"
              name="email"
              autoComplete="email"
              className="h-8 flex-1"
              placeholder="another@example.com"
              value={email}
              disabled={isBusy}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Button type="submit" size="sm" disabled={isBusy || !email.trim()}>
              Add address
            </Button>
          </form>
        </Card>
      </TooltipProvider>

      <p className="mt-2 text-xs text-muted-foreground">
        Sign in with any verified address. Commits you push from one count
        towards your contributions.
      </p>
    </div>
  );
}

/** The verification link lands back here with its result in the URL. Report it once, then strip it so a refresh does not repeat the toast. */
function useVerificationResult() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const result = searchParams.get("email");

  useEffect(() => {
    if (!result) return;

    if (result === "verified") toast.success("Email address confirmed");
    if (result === "invalid") {
      toast.error("That verification link is invalid or has expired");
    }

    router.replace("/settings/account");
  }, [result, router]);
}

function EmailRowSkeleton() {
  return (
    <Item>
      <ItemMedia>
        <Skeleton className="size-10 rounded-md" />
      </ItemMedia>
      <ItemContent>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-20" />
      </ItemContent>
    </Item>
  );
}
