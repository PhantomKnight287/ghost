import Link from "next/link";
import { redirect } from "next/navigation";
import {
  FileCode2,
  GitBranch,
  GitPullRequest,
  Ghost,
  History,
  KeyRound,
  Lock,
  MessageSquare,
  Network,
  Terminal,
  Webhook,
  File,
  Folder,
  GitCommitHorizontal,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getServerSession } from "@/lib/api/server";
import { API_URL } from "@/lib/env";

const FEATURES = [
  {
    icon: Terminal,
    title: "Push and pull over HTTP",
    description:
      "A real git remote. Clone, fetch and push with the git you already have - no client, no daemon, no extra port.",
  },
  {
    icon: FileCode2,
    title: "Read your code in the browser",
    description:
      "Syntax highlighting for 300+ languages, images and PDFs rendered in place, and raw downloads for everything else.",
  },
  {
    icon: GitBranch,
    title: "Every branch, one click away",
    description:
      "Switch refs from any directory or file view. Trees, blobs and history all follow the branch you are on.",
  },
  {
    icon: History,
    title: "Commit context on every row",
    description:
      "Directory listings show the newest commit touching each entry, indexed up front instead of walked per request.",
  },
  {
    icon: Lock,
    title: "Private by choice",
    description:
      "Public repositories are readable by anyone; private ones stay invisible to everyone but you, over HTTP and the web alike.",
  },
  {
    icon: Ghost,
    title: "Durable by design",
    description:
      "Every push is appended to a write-ahead log in object storage. Local disk is only a cache, so a repository can be rebuilt wherever it is next needed.",
  },
];

const PREVIEW_ENTRIES = [
  {
    type: "tree",
    name: "apps",
    message: "split the api and the web app",
    age: "2 hours ago",
  },
  {
    type: "tree",
    name: "packages",
    message: "share the database schema",
    age: "2 days ago",
  },
  {
    type: "blob",
    name: "README.md",
    message: "explain what this is",
    age: "5 days ago",
  },
  {
    type: "blob",
    name: "package.json",
    message: "bump the workspace",
    age: "last week",
  },
];

const FAQ = [
  {
    question: "Does it work with the git I already have?",
    answer:
      "Yes. A Ghost repository is a plain HTTP remote, so clone, fetch, pull and push all work with stock git. There is nothing to install and no plugin to add.",
  },
  {
    question: "Can repositories be private?",
    answer:
      "Every repository is public or private, and a private one is invisible to everyone but its owner - over HTTP and in the browser alike. Visibility is checked on the way in, not hidden in the interface.",
  },
  {
    question: "How do accounts work?",
    answer:
      "Sign up with an email address and a password, pick a username, and your repositories live under it. That username is the first part of every clone URL.",
  },
  {
    question: "What happens with large files?",
    answer:
      "Files past a megabyte are not rendered in the browser, but they download in full at their original size. Git LFS is not supported yet.",
  },
  {
    question: "Is it ready for a team?",
    answer:
      "It is ready for your repositories today. It is not ready for a team review workflow - that arrives with pull requests and issues.",
  },
  {
    question: "What does it take to run?",
    answer:
      "An API process, a web app, a PostgreSQL database and an S3-compatible bucket. The bucket holds the write-ahead log that every repository is replayed from; the git directories on disk are a cache you can throw away.",
  },
];

const STEPS = [
  {
    title: "Create a repository",
    description:
      "Name it. Public or private. It exists as a bare repository the moment you press create.",
  },
  {
    title: "Add it as a remote",
    description:
      "The repository page hands you the clone URL, ready to paste into the project you already have.",
  },
  {
    title: "Push",
    description:
      "Your files, branches and history show up in the browser as soon as the push lands.",
  },
];

const STACK = [
  "Next.js",
  "NestJS",
  "PostgreSQL",
  "Drizzle",
  "S3-compatible storage",
];

const ROADMAP = [
  {
    icon: MessageSquare,
    title: "Issues",
    description:
      "Threads attached to a repository, with labels and assignees. The tab is already waiting for them.",
    status: "Next",
  },
  {
    icon: GitPullRequest,
    title: "Pull requests",
    description:
      "Branch comparison, review conversation on a diff, and a merge that runs server-side.",
    status: "Next",
  },
  {
    icon: KeyRound,
    title: "SSH access",
    description:
      "git over SSH with your own keys, served by a dedicated process rather than bolted onto the API.",
    status: "Planned",
  },
  {
    icon: Network,
    title: "A service split",
    description:
      "The SSH front end talks to the git core over gRPC, so the transport a client picks stops mattering.",
    status: "Planned",
  },
  {
    icon: Webhook,
    title: "Webhooks",
    description:
      "Push events posted to a URL you own - the hook every CI runner is waiting for.",
    status: "Planned",
  },
];

export default async function LandingPage() {
  const session = await getServerSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 md:px-6">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <Ghost className="size-5 text-primary" />
            Ghost
          </span>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/auth/sign-up">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-4 py-20 md:px-6">
        <section className="flex flex-col items-center gap-6 text-center">
          <Badge variant="outline" className="rounded-full">
            Self-hosted git, without the weight
          </Badge>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            Your repositories, on your own machine
          </h1>

          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            Ghost is a git host you can run yourself. Push over HTTP, browse
            your code, switch branches - and nothing you did not ask for.
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/auth/sign-up">Create an account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
          </div>

          <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-lg border bg-card text-left shadow-sm">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-destructive/60" />
              <span className="size-2.5 rounded-full bg-muted-foreground/40" />
              <span className="size-2.5 rounded-full bg-primary/60" />
              <span className="ml-2 text-xs text-muted-foreground">
                push an existing repository
              </span>
            </div>

            <pre className="overflow-x-auto p-4 font-mono text-sm leading-relaxed">
              <code>
                <span className="text-muted-foreground">$ </span>
                git remote add origin {API_URL}/you/project.git{"\n"}
                <span className="text-muted-foreground">$ </span>
                git push -u origin main
              </code>
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-3 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">
              A repository, the way you expect to read one
            </h2>
            <p className="mx-auto max-w-lg text-pretty text-muted-foreground">
              Directories first, the latest commit against every row, and the
              branch you are on never more than a click away.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <span className="flex items-center gap-1 text-sm">
                <span className="text-primary">you</span>
                <span className="text-muted-foreground">/</span>
                <span className="font-semibold">project</span>
              </span>
              <Badge variant="outline" className="rounded-full text-xs">
                Public
              </Badge>
              <span className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs">
                <GitBranch className="size-3.5 text-muted-foreground" />
                main
              </span>
            </div>

            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
              <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">
                serve raw file contents
              </span>
              <code className="ml-auto shrink-0 text-xs text-muted-foreground">
                a3f19c2
              </code>
            </div>

            <ul className="divide-y">
              {PREVIEW_ENTRIES.map((entry) => (
                <li
                  key={entry.name}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  {entry.type === "tree" ? (
                    <Folder className="size-4 shrink-0 fill-muted text-primary" />
                  ) : (
                    <File className="size-4 shrink-0 fill-muted text-muted-foreground" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  <span className="ml-auto hidden truncate text-xs text-muted-foreground md:block">
                    {entry.message}
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {entry.age}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="flex flex-col gap-3 rounded-lg border bg-card p-6"
            >
              <Icon className="size-5 text-primary" />
              <h2 className="font-semibold">{title}</h2>
              <p className="text-sm text-pretty text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-3 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">
              Three commands from empty to hosted
            </h2>
            <p className="mx-auto max-w-md text-pretty text-muted-foreground">
              No setup wizard, no config file, no CI to configure before the
              first push works.
            </p>
          </div>

          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map(({ title, description }, index) => (
              <li key={title} className="flex flex-col gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 font-mono text-sm font-medium text-primary">
                  {index + 1}
                </span>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-pretty text-muted-foreground">
                  {description}
                </p>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center justify-center gap-2 border-t pt-8">
            <span className="text-sm text-muted-foreground">Running on</span>
            {STACK.map((item) => (
              <Badge key={item} variant="secondary" className="rounded-full">
                {item}
              </Badge>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-3 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">
              What comes next
            </h2>
            <p className="mx-auto max-w-lg text-pretty text-muted-foreground">
              Ghost is early and honest about it. These are being built, in
              roughly this order - nothing here is shipped yet.
            </p>
          </div>

          <ul className="grid gap-4 sm:grid-cols-2">
            {ROADMAP.map(({ icon: Icon, title, description, status }) => (
              <li
                key={title}
                className="flex gap-4 rounded-lg border border-dashed p-6"
              >
                <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{title}</h3>
                    <Badge
                      variant={status === "Next" ? "default" : "outline"}
                      className="rounded-full text-xs"
                    >
                      {status}
                    </Badge>
                  </div>
                  <p className="text-sm text-pretty text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-10">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-balance">
            Questions worth asking first
          </h2>

          <div className="grid gap-8 md:grid-cols-2">
            {FAQ.map(({ question, answer }) => (
              <div key={question} className="flex flex-col gap-2">
                <h3 className="font-semibold">{question}</h3>
                <p className="text-sm text-pretty text-muted-foreground">
                  {answer}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-center gap-6 rounded-lg border border-dashed px-6 py-16 text-center">
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-balance">
            Start with one repository
          </h2>
          <p className="max-w-md text-pretty text-muted-foreground">
            Create an account, add a remote, push. Everything else can wait
            until you need it.
          </p>
          <Button asChild size="lg">
            <Link href="/auth/sign-up">Get started</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-6 text-sm text-muted-foreground md:px-6">
          <Ghost className="size-4" />
          Ghost
          <span className="ml-auto">Self-hosted git</span>
        </div>
      </footer>
    </div>
  );
}
