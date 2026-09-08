import { GitFork } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { ForkRepositoryForm } from "@/components/repositories/fork-repository-form";
import { Button } from "@/components/ui/button";
import { createServerClient, getServerSession } from "@/lib/api/server";

export default async function ForkRepositoryPage({
  params,
}: PageProps<"/[username]/[repo]/fork">) {
  const { username, repo } = await params;

  const [session, client] = await Promise.all([
    getServerSession(),
    createServerClient(),
  ]);

  const viewer = session?.user.username;
  if (!viewer) {
    redirect(
      `/auth/sign-in?redirectTo=${encodeURIComponent(`/${username}/${repo}/fork`)}`,
    );
  }

  const repository = await client.GET("/api/repositories/{username}/{slug}", {
    params: { path: { username, slug: repo } },
  });

  if (repository.response.status === 404) notFound();
  if (repository.error || !repository.data) {
    throw new Error(`Failed to load ${username}/${repo}`);
  }

  // One fork per owner, so an owner who already has one is offered their fork instead.
  const existingFork = repository.data.viewerForkSlug;
  const ownsParent = viewer === username;

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={viewer} owners={[viewer]} />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <GitFork className="size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">
              Fork{" "}
              <Link
                href={`/${username}/${repo}`}
                className="text-primary hover:underline"
              >
                {username}/{repository.data.name}
              </Link>
            </span>
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            A fork is a copy of a repository. It keeps its own history from the
            moment you create it.
          </p>
        </div>

        {ownsParent ? (
          <Notice
            message="You already own this repository, so there is nothing to fork."
            href={`/${username}/${repo}`}
            action="Back to repository"
          />
        ) : existingFork ? (
          <Notice
            message={`You already forked this repository as ${viewer}/${existingFork}.`}
            href={`/${viewer}/${existingFork}`}
            action="Go to your fork"
          />
        ) : (
          <ForkRepositoryForm
            parentUsername={username}
            parentSlug={repo}
            name={repository.data.name}
            description={repository.data.description}
            visibility={repository.data.visibility}
            owners={[viewer]}
            defaultOwner={viewer}
          />
        )}
      </main>
    </div>
  );
}

function Notice({
  message,
  href,
  action,
}: {
  message: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <p className="text-sm">{message}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}
