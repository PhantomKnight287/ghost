import { signInWithGhost } from "@/lib/auth-client.ts";
import { Button } from "../ui/button.tsx";
import { AppMark } from "./app-mark.tsx";

const POINTS = [
  { title: "Code", body: "Branches and tags move both ways. A branch changed on both sides is flagged, never overwritten." },
  { title: "Conversations", body: "Issues, pull requests, comments and reviews are copied and credited to the people who wrote them." },
  { title: "Checks", body: "CI results from either side show on the other, so reviews wait on the same signals." },
];

export function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-12 px-4 py-16">
      <div className="flex flex-col items-start gap-6">
        <AppMark />
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Keep a Ghost repository and a GitHub repository in step.</h1>
        <p className="max-w-xl text-lg text-zinc-500 dark:text-zinc-400">Pair two repositories once. Every push, issue and review made on one side shows up on the other.</p>
        <Button onClick={() => signInWithGhost()} className="h-10 px-4 text-sm">
          Sign in with Ghost
        </Button>
      </div>
      <dl className="grid gap-6 border-t border-zinc-200 pt-8 sm:grid-cols-3 dark:border-zinc-800">
        {POINTS.map((point) => (
          <div key={point.title} className="flex flex-col gap-1.5">
            <dt className="text-sm font-medium">{point.title}</dt>
            <dd className="text-sm text-zinc-500 dark:text-zinc-400">{point.body}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
