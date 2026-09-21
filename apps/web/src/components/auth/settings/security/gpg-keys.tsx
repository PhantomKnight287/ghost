"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { DOCS_URL } from "@/lib/env";
import { cn } from "@/lib/utils";

export type GpgKeysProps = {
  className?: string;
};

type GpgKey = {
  id: string;
  keyId: string;
  fingerprint: string;
  emails: string[];
  createdAt: string;
};

const QUERY_KEY = ["gpg-keys"];

/**
 * Public keys that make this account's signed commits read as verified.
 *
 * A key is only accepted once it carries an address the account has already
 * verified, so the form points at the email settings when it is refused.
 */
export function GpgKeys({ className }: GpgKeysProps) {
  const queryClient = useQueryClient();
  const [publicKey, setPublicKey] = useState("");

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/gpg-keys");
      if (error) throw new Error(apiErrorMessage(error));
      return data.keys as GpgKey[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const add = useMutation({
    mutationFn: async (value: string) => {
      const { error } = await apiClient.POST("/api/gpg-keys", {
        body: { publicKey: value },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async () => {
      setPublicKey("");
      toast.success("Key added");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE("/api/gpg-keys/{id}", {
        params: { path: { id } },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async () => {
      toast.success("Key removed");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isBusy = add.isPending || remove.isPending;
  const keys = data ?? [];

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">GPG keys</h2>

      <Card className={cn("gap-0 p-0", className)}>
        <CardContent className="p-0">
          <ItemGroup className="gap-0!">
            {isPending ? (
              <KeyRowSkeleton />
            ) : keys.length === 0 ? (
              <Item>
                <ItemContent>
                  <ItemDescription>
                    No keys yet. Commits you sign will read as unverified.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              keys.map((key, index) => (
                <Fragment key={key.id}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <Item>
                    <ItemMedia variant="icon">
                      <KeyRound />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="font-mono">{key.keyId}</ItemTitle>
                      <ItemDescription>
                        {key.emails.join(", ") || "No address on the key"}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => remove.mutate(key.id)}
                      >
                        Remove
                      </Button>
                    </ItemActions>
                  </Item>
                </Fragment>
              ))
            )}
          </ItemGroup>
        </CardContent>

        <form
          className="flex flex-col gap-2 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (publicKey.trim()) add.mutate(publicKey.trim());
          }}
        >
          <Textarea
            name="publicKey"
            className="h-28 font-mono text-xs"
            placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
            value={publicKey}
            disabled={isBusy}
            onChange={(event) => setPublicKey(event.target.value)}
            required
          />
          <Button
            type="submit"
            size="sm"
            className="self-end"
            disabled={isBusy || !publicKey.trim()}
          >
            Add key
          </Button>
        </form>
      </Card>

      <p className="mt-2 text-xs text-muted-foreground">
        Paste what <code>gpg --armor --export &lt;key id&gt;</code> prints. The
        key must carry an address you have verified on this account, and only
        commits authored from that address read as verified.{" "}
        <a
          className="underline underline-offset-2"
          href={`${DOCS_URL}/adding-a-gpg-key-to-your-account`}
          target="_blank"
          rel="noreferrer"
        >
          Read the guide
        </a>
        .
      </p>
    </div>
  );
}

function KeyRowSkeleton() {
  return (
    <Item>
      <ItemMedia variant="icon">
        <KeyRound />
      </ItemMedia>
      <ItemContent className="gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </ItemContent>
    </Item>
  );
}
