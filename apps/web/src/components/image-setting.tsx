"use client";

import { useAuth } from "@better-auth-ui/react";
import { Upload } from "lucide-react";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { ProfileAvatar } from "@/components/users/profile-avatar";
import { deleteImage, putImage } from "@/lib/auth/avatar";

/** Upload or remove a picture an API path stores, such as an organization's logo. Uploads are resized to the same square as account avatars before they are sent. */
export function ImageSetting({
  title,
  hint,
  name,
  image,
  path,
  disabled,
  onChanged,
}: {
  title: string;
  hint: ReactNode;
  /** Initials drawn when there is no picture. */
  name: string;
  image: string | null | undefined;
  path: string;
  disabled?: boolean;
  onChanged: () => unknown;
}) {
  const { avatar } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      await onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const resized =
      (await avatar.resize?.(file, avatar.size, avatar.extension)) ?? file;
    await run(() => putImage(path, resized), `${title} updated`);
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <Card className="py-0">
        <Item>
          <ItemMedia>
            <ProfileAvatar
              name={name}
              image={image}
              className="size-16 rounded-xl"
              fallbackClassName="text-lg"
            />
          </ItemMedia>
          <ItemContent>
            <ItemDescription>{hint}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={upload}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? <Spinner /> : <Upload />}
              Upload
            </Button>
            {image && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => deleteImage(path), `${title} removed`)}
              >
                Remove
              </Button>
            )}
          </ItemActions>
        </Item>
      </Card>
    </section>
  );
}
