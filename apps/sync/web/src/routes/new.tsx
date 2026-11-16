import { createFileRoute } from "@tanstack/react-router";
import { SignedIn } from "@/components/layout/signed-in.tsx";
import { NewSyncForm } from "@/components/new-sync/new-sync-form.tsx";

export const Route = createFileRoute("/new")({ ssr: false, component: NewSyncPage });

function NewSyncPage() {
  return (
    <SignedIn>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">New sync</h1>
      <NewSyncForm />
    </SignedIn>
  );
}
