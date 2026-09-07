"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchClient } from "@/lib/fetch-client";

export function StarButton({
  username,
  slug,
  starCount,
  viewerHasStarred,
  signedIn,
}: {
  username: string;
  slug: string;
  starCount: number;
  viewerHasStarred: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<{
    starCount: number;
    viewerHasStarred: boolean;
  }>();

  const state = pending ?? { starCount, viewerHasStarred };

  async function toggle() {
    if (!signedIn) {
      router.push(
        `/auth/sign-in?redirectTo=${encodeURIComponent(`/${username}/${slug}`)}`,
      );
      return;
    }

    const starred = !state.viewerHasStarred;
    setPending({
      starCount: state.starCount + (starred ? 1 : -1),
      viewerHasStarred: starred,
    });

    const request = starred ? fetchClient.POST : fetchClient.DELETE;
    const { data, error } = await request(
      "/api/repositories/{username}/{slug}/star",
      { params: { path: { username, slug } } },
    );

    if (error || !data) {
      setPending(undefined);
      toast.error(`Could not ${starred ? "star" : "unstar"} ${slug}`);
      return;
    }

    setPending(data);
    // Anything else showing the count - the owner's repository list - is stale now.
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle}>
      <Star
        data-icon="inline-start"
        className={state.viewerHasStarred ? "fill-current" : undefined}
      />
      {state.viewerHasStarred ? "Starred" : "Star"}
      <span className="ml-1 text-muted-foreground tabular-nums">
        {state.starCount}
      </span>
    </Button>
  );
}
