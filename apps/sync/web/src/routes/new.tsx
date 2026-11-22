import { createFileRoute } from "@tanstack/react-router";
import { BackToSyncs } from "@/components/layout/back-to-syncs.tsx";
import { PageHeader } from "@/components/layout/page-header.tsx";
import { SignedIn } from "@/components/layout/signed-in.tsx";
import { NewSyncForm } from "@/components/new-sync/new-sync-form.tsx";

export const Route = createFileRoute("/new")({ ssr: false, component: NewSyncPage });

function NewSyncPage() {
  return (
    <SignedIn>
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-6">
          <BackToSyncs />
          <PageHeader title="New sync" description="Pair a Ghost repository with a GitHub repository. The first sync copies what each side is missing; nothing that exists is overwritten." />
        </div>
        <NewSyncForm />
      </div>
    </SignedIn>
  );
}
