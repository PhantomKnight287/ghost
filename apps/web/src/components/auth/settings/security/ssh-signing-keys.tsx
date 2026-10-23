"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PenLine } from "lucide-react";
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
import { apiClient, unwrap } from "@/lib/api/client";
import { DOCS_URL } from "@/lib/env";

const QUERY_KEY = ["ssh-signing-keys"];

/** SSH keys this account signs commits with (`gpg.format=ssh`). Kept apart from the keys that open git sessions, as on GitHub: a key can be in both lists, and one here grants no SSH access. */
export function SshSigningKeys() {
  const queryClient = useQueryClient();
  const [publicKey, setPublicKey] = useState("");
  const [title, setTitle] = useState("");

  const { data, isPending } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const data = await unwrap(apiClient.GET("/api/ssh-signing-keys"));
      return data.keys;
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const add = useMutation({
    mutationFn: async () => {
      await unwrap(
        apiClient.POST("/api/ssh-signing-keys", {
          body: {
            publicKey: publicKey.trim(),
            ...(title.trim() ? { title: title.trim() } : {}),
          },
        }),
      );
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
      await unwrap(
        apiClient.DELETE("/api/ssh-signing-keys/{id}", {
          params: { path: { id } },
        }),
      );
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
      <h2 className="mb-3 text-sm font-semibold">SSH signing keys</h2>

      <Card className={"gap-0 p-0"}>
        <CardContent className="p-0">
          <ItemGroup className="gap-0!">
            {isPending ? (
              <KeyRowSkeleton />
            ) : keys.length === 0 ? (
              <Item>
                <ItemContent>
                  <ItemDescription>
                    No signing keys yet. Add one to get the Verified badge on
                    commits you sign with SSH.
                  </ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              keys.map((key, index) => (
                <Fragment key={key.id}>
                  {index > 0 && <ItemSeparator className="my-0!" />}
                  <Item>
                    <ItemMedia variant="icon">
                      <PenLine />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{key.title}</ItemTitle>
                      <ItemDescription className="font-mono text-xs">
                        SHA256:{key.fingerprint}
                      </ItemDescription>
                      <ItemDescription>{key.type}</ItemDescription>
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
            Add signing key
          </Button>
        </form>
      </Card>

      <p className="mt-2 text-xs text-muted-foreground">
        Paste the public key git signs with, such as{" "}
        <code>~/.ssh/id_ed25519.pub</code>. It does not let anyone push over
        SSH; add it under SSH keys too for that.{" "}
        <a
          className="underline underline-offset-2"
          href={`${DOCS_URL}/signing/adding-an-ssh-signing-key`}
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
        <PenLine />
      </ItemMedia>
      <ItemContent className="gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </ItemContent>
    </Item>
  );
}
