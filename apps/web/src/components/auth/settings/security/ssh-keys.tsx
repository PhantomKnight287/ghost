"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TerminalSquare } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export type SshKeysProps = {
  className?: string;
};

type SshKey = {
  id: string;
  title: string;
  type: string;
  fingerprint: string;
  lastUsedAt: string | null;
  createdAt: string;
};

const QUERY_KEY = ["ssh-keys"];

/** Keys that let this account fetch and push over SSH. Anyone holding the matching private key connects as this account, which is why the list shows when each one was last used. */
export function SshKeys({ className }: SshKeysProps) {
  const queryClient = useQueryClient();
  const [publicKey, setPublicKey] = useState("");
  const [title, setTitle] = useState("");

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/api/ssh-keys");
      if (error) throw new Error(apiErrorMessage(error));
      return data.keys as SshKey[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await apiClient.POST("/api/ssh-keys", {
        body: {
          publicKey: publicKey.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
        },
      });
      if (error) throw new Error(apiErrorMessage(error));
    },
    onSuccess: async () => {
      setPublicKey("");
      setTitle("");
      toast.success("Key added");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await apiClient.DELETE("/api/ssh-keys/{id}", {
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
      <h2 className="mb-3 text-sm font-semibold">SSH keys</h2>

      <Card className={cn("gap-0 p-0", className)}>
        <CardContent className="p-0">
          <ItemGroup className="gap-0!">
            {isPending ? (
              <KeyRowSkeleton />
            ) : keys.length === 0 ? (
              <Item>
                <ItemContent>
                  <ItemDescription>
                    No keys yet. Clone and push over HTTPS, or add a key to use
                    SSH.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              keys.map((key, index) => (
                <Fragment key={key.id}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <Item>
                    <ItemMedia variant="icon">
                      <TerminalSquare />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{key.title}</ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        SHA256:{key.fingerprint}
                      </ItemDescription>
                      <ItemDescription>
                        {key.type} · {lastUsed(key.lastUsedAt)}
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
            if (publicKey.trim()) add.mutate();
          }}
        >
          <Input
            name="title"
            placeholder="Title, e.g. work laptop"
            value={title}
            disabled={isBusy}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            name="publicKey"
            className="h-24 font-mono text-xs"
            placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... you@laptop"
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
        Paste the contents of <code>~/.ssh/id_ed25519.pub</code> — the public
        half, never the file without <code>.pub</code>.{" "}
        <a
          className="underline underline-offset-2"
          href={`${DOCS_URL}/adding-an-ssh-key-to-your-account`}
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

function lastUsed(timestamp: string | null) {
  if (!timestamp) return "Never used";
  return `Last used ${new Date(timestamp).toLocaleDateString()}`;
}

function KeyRowSkeleton() {
  return (
    <Item>
      <ItemMedia variant="icon">
        <TerminalSquare />
      </ItemMedia>
      <ItemContent className="gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </ItemContent>
    </Item>
  );
}
