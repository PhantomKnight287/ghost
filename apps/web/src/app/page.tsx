import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Ghost</h1>
        <p className="text-muted-foreground">Sign in to continue.</p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/auth/sign-up">Register</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
