/* Hallmark · genre: modern-minimal · macrostructure: Split Studio · theme: app tokens (globals.css, theme-picker aware)
 * enrichment: none (proof panels drawn from the app's own UI) · nav: N5 floating pill · footer: Ft5 statement
 * pre-emit critique: P5 H4 E4 S5 R5 V4
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BadgeCheck, Ghost, GitMerge, Lock, Search } from "lucide-react";

import { ThemePicker } from "@/components/theme-picker";
import { Button } from "@/components/ui/button";

import { getServerSession } from "@/lib/api/server";
import { API_URL, DOCS_URL } from "@/lib/env";

const REMOTE = `${API_URL}/you/billing.git`;

/** Every section sits on this grid, so each right-hand column starts on the same line. */
const COLUMNS =
  "grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16";

const ALSO = [
  "Issues with labels and assignees",
  "Link issues and PRs with #123",
  "Tags and releases",
  "Forks and stars",
  "READMEs in every folder",
  "Highlighting for 300+ languages",
  "Language breakdown per repository",
  "Contribution graph on profiles",
  "Notifications for your threads",
  "Access tokens for scripts and CI",
  "SSH and GPG keys per account",
  "Light, dark and custom themes",
];

const FAQ = [
  {
    question: "Will my team need to learn anything?",
    answer:
      "No. It is plain git over HTTP or SSH, and pull requests, reviews and issues work the way they do everywhere else. Change the remote and keep working.",
  },
  {
    question: "What if the server dies?",
    answer:
      "Start another one. Every push is saved to your storage bucket first, so nothing lives only on the disk you lost.",
  },
  {
    question: "Who can see our code?",
    answer:
      "Only the people you let in. Private repositories are invisible to everyone else, in the browser and over git alike.",
  },
  {
    question: "What does it take to run?",
    answer:
      "The Ghost API and web app, a PostgreSQL database and any S3-compatible bucket. The docs walk through the setup.",
  },
  {
    question: "Anything missing?",
    answer:
      "Git LFS is not supported yet, and webhooks are being built now. Files over a megabyte still download in full; they just skip the browser preview.",
  },
];

export default async function LandingPage() {
  const session = await getServerSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <nav
        aria-label="Primary"
        className="fixed top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/80 py-1 pr-1 pl-4 shadow-[0_8px_24px_-12px_oklch(0_0_0/0.25)] backdrop-blur"
      >
        <span className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
          <Ghost className="size-4 text-primary" />
          Ghost
        </span>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden rounded-full sm:inline-flex"
        >
          <a href={DOCS_URL}>Docs</a>
        </Button>
        <ThemePicker />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden rounded-full sm:inline-flex"
        >
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
        <Button asChild size="sm" className="rounded-full">
          <Link href="/auth/sign-up">Create account</Link>
        </Button>
      </nav>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-24 px-4 pt-32 pb-24 md:px-8 md:pt-44">
        <section className="flex flex-col gap-12">
          <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.04em] text-balance [overflow-wrap:anywhere] sm:text-6xl lg:text-7xl">
            Stop renting a home for your code.
          </h1>
          <div className={COLUMNS}>
            <div className="flex min-w-0 flex-col gap-8">
              <p className="max-w-md text-lg text-pretty text-muted-foreground">
                Ghost does what your team uses GitHub for every day: pull
                requests, reviews, issues and code search, on a server you run.
                The price, the rules and who reads your code stay your call.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg" className="h-11 rounded-full px-5">
                  <Link href="/auth/sign-up">Create an account</Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-11 rounded-full px-5"
                >
                  <Link href="/auth/sign-in">Sign in</Link>
                </Button>
              </div>
            </div>

            <Panel>
              <PanelHead>Moving a repository over</PanelHead>
              {/* wraps instead of scrolling: the remote URL is as long as the instance's hostname */}
              <pre className="p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                <code>
                  <Prompt />
                  git remote add ghost {REMOTE}
                  {"\n"}
                  <Prompt />
                  git push ghost --all
                  {"\n"}
                  <span className="text-muted-foreground">
                    {" * [new branch] main -> main\n"}
                    {" * [new branch] release -> release"}
                  </span>
                </code>
              </pre>
            </Panel>
          </div>
        </section>

        <Split
          title="Your team won&rsquo;t have to relearn a thing."
          body="Open a pull request, review the diff line by line, squash and merge. It is the workflow everyone already knows, so switching takes an afternoon, not a quarter."
          facts={[
            "Stock git over HTTP or SSH",
            "Merge, squash or rebase",
            "Issues, labels, releases and forks",
          ]}
        >
          <ReviewProof />
        </Split>

        <Split
          title="A dead server costs you an hour, not your history."
          body="Every push is saved to your own storage bucket before Ghost says it is done. If the machine dies, start a new one and every commit and branch comes back with it."
          facts={[
            "Any S3-compatible storage",
            "Nothing lives only on the disk",
            "Switch machines with a restart",
          ]}
        >
          <DurabilityProof />
        </Split>

        <Split
          title="Stop asking where that code lives."
          body="Search every repository you can read at once. New code is searchable the moment it is pushed, so the answer is never buried in a chat thread."
          facts={[
            "Across every repository, or just one",
            "Updated on every push",
            "Private code stays out of other people’s results",
          ]}
        >
          <SearchProof />
        </Split>

        <Split
          title="Give access without giving away the keys."
          body="Group people into organizations and teams, then give each exactly the access they need. A contractor sees one repository. Everyone outside sees nothing."
          facts={[
            "Read, triage, write, maintain or admin",
            "Outside collaborators, per repository",
            "Invitations expire after 7 days",
          ]}
        >
          <RolesProof />
        </Split>

        <Split
          title="Know which commits are really yours."
          body="Sign commits with your GPG key and Ghost marks them Verified. A signature from a key that isn’t on your account shows as Unverified, where everyone can see it."
          facts={[
            "Checked against keys you uploaded",
            "Remove a key and its commits stop verifying",
            "Push with SSH keys, no passwords",
          ]}
        >
          <SignatureProof />
        </Split>

        <section className={`${COLUMNS} border-t pt-10`}>
          <SectionTitle>Plus the things you reach for daily.</SectionTitle>
          {/* -mt-3 cancels the first row's padding so its text lines up with the heading */}
          <ul className="-mt-3 grid gap-x-8 sm:grid-cols-2">
            {ALSO.map((item) => (
              <li
                key={item}
                className="border-b py-3 text-sm text-pretty text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className={`${COLUMNS} border-t pt-10`}>
          <SectionTitle>Before you switch.</SectionTitle>
          <dl className="flex flex-col">
            {FAQ.map(({ question, answer }) => (
              <div
                key={question}
                className="flex flex-col gap-2 border-b py-5 first:pt-0 last:border-0 last:pb-0"
              >
                <dt className="font-medium">{question}</dt>
                <dd className="max-w-xl text-sm text-pretty text-muted-foreground">
                  {answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-col px-4 md:px-8">
        <section className="flex flex-col items-start gap-8 border-t pt-16 pb-24 md:pt-24 md:pb-32">
          <p className="max-w-[16ch] text-5xl font-semibold tracking-[-0.04em] text-balance [overflow-wrap:anywhere] md:text-7xl">
            Move one repository this afternoon.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 rounded-full px-5">
              <Link href="/auth/sign-up">Create an account</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-11 rounded-full px-5"
            >
              <a href={DOCS_URL}>Read the docs</a>
            </Button>
          </div>
        </section>
        <div className="flex items-center gap-2 border-t py-6 text-sm text-muted-foreground">
          <Ghost className="size-4" />
          Ghost
          <span className="ml-auto">Git hosting you own</span>
        </div>
      </footer>
    </div>
  );
}

function Prompt() {
  return <span className="text-muted-foreground select-none">$ </span>;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-3xl font-semibold tracking-[-0.03em] text-balance [overflow-wrap:anywhere] md:text-4xl">
      {children}
    </h2>
  );
}

function Split({
  title,
  body,
  facts,
  children,
}: {
  title: string;
  body: string;
  facts: string[];
  children: ReactNode;
}) {
  return (
    <section className={`${COLUMNS} border-t pt-10`}>
      <div className="flex min-w-0 flex-col gap-5">
        <SectionTitle>{title}</SectionTitle>
        <p className="max-w-md text-pretty text-muted-foreground">{body}</p>
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {facts.map((fact) => (
            <li key={fact} className="flex items-baseline gap-2.5">
              <span
                aria-hidden
                className="size-1 shrink-0 translate-y-[-0.2em] rounded-full bg-primary"
              />
              {fact}
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 overflow-hidden rounded-xl border bg-card text-sm ${className}`}
    >
      {children}
    </div>
  );
}

function PanelHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-11 items-center gap-2 border-b px-4 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function DurabilityProof() {
  const layers = [
    { label: "git push", note: "you push as usual" },
    { label: "your bucket", note: "saved here first, kept for good" },
    { label: "server disk", note: "a copy Ghost can rebuild" },
  ];
  return (
    <Panel>
      <PanelHead>Where every push goes</PanelHead>
      <ol className="divide-y">
        {layers.map(({ label, note }, index) => (
          <li
            key={label}
            className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3.5 ${
              index === 1 ? "bg-primary/5" : ""
            }`}
          >
            <span className="w-5 font-mono text-xs text-muted-foreground">
              {index + 1}
            </span>
            <span className="font-mono font-medium">{label}</span>
            <span className="basis-full pl-9 text-xs text-muted-foreground sm:ml-auto sm:basis-auto sm:pl-0">
              {note}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function ReviewProof() {
  const lines = [
    { kind: " ", text: "function total(items) {" },
    { kind: "-", text: "  return sum(items);" },
    { kind: "+", text: "  return round(sum(items), 2);" },
    { kind: " ", text: "}" },
  ];
  return (
    <Panel>
      <PanelHead>
        <span className="truncate font-medium text-foreground">
          Round invoice totals once
        </span>
        #14
      </PanelHead>
      <pre className="py-2 font-mono text-xs leading-6">
        {lines.map(({ kind, text }, index) => (
          <div
            key={index}
            className={`truncate px-4 ${
              kind === "+"
                ? "bg-primary/10"
                : kind === "-"
                  ? "bg-destructive/10 text-destructive"
                  : ""
            }`}
          >
            <span
              aria-hidden
              className="mr-3 text-muted-foreground select-none"
            >
              {kind}
            </span>
            {text}
          </div>
        ))}
      </pre>
      <div className="flex h-12 items-center gap-3 border-t px-4">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 shrink-0 text-primary" />
          Approved
          <span className="hidden sm:inline">
            at <code className="font-mono">a3f19c2</code>
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
          <GitMerge className="size-3.5" />
          Squash and merge
        </span>
      </div>
    </Panel>
  );
}

function SearchProof() {
  const hits = [
    {
      path: "billing/src/cart.ts",
      line: 42,
      before: "return cart.",
      after: "(code);",
    },
    {
      path: "checkout/src/pay.ts",
      line: 18,
      before: "await ",
      after: "(order);",
    },
  ];
  return (
    <Panel>
      <PanelHead>
        <Search className="size-3.5" />
        <span className="font-mono">
          org:you <span className="text-foreground">discount</span>
        </span>
      </PanelHead>
      <ul className="divide-y">
        {hits.map(({ path, line, before, after }) => (
          <li key={path} className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
            <span className="truncate text-xs font-medium">{path}</span>
            <code className="truncate font-mono text-xs text-muted-foreground">
              <span className="mr-3 select-none">{line}</span>
              {before}
              <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
                discount
              </mark>
              {after}
            </code>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RolesProof() {
  const roles = ["read", "triage", "write", "maintain", "admin"];
  return (
    <Panel>
      <PanelHead>
        <Lock className="size-3.5" />
        you/billing is private
      </PanelHead>
      <ol className="flex items-end gap-1 px-3 pt-5 sm:gap-1.5 sm:px-4 pb-4">
        {roles.map((role, index) => (
          <li
            key={role}
            className="flex min-w-0 flex-1 flex-col items-center gap-2"
          >
            <span
              aria-hidden
              className={`w-full rounded-md ${index === 2 ? "bg-primary" : "bg-muted"}`}
              style={{ height: `${1.25 + index}rem` }}
            />
            <span
              className={`max-w-full truncate font-mono text-[10px] sm:text-[11px] ${index === 2 ? "text-foreground" : "text-muted-foreground"}`}
            >
              {role}
            </span>
          </li>
        ))}
      </ol>
      <p className="border-t px-4 py-3 text-xs text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">platform-team</span> can
        push and merge. Everyone outside the team gets a 404.
      </p>
    </Panel>
  );
}

function SignatureProof() {
  const commits = [
    { message: "Fix the invoice rounding", sha: "e41b0d7", verified: true },
    { message: "Add the export button", sha: "a3f19c2", verified: true },
    { message: "Update deploy credentials", sha: "9c02f51", verified: false },
  ];
  return (
    <Panel>
      <PanelHead>Commits on main</PanelHead>
      <ul className="divide-y">
        {commits.map(({ message, sha, verified }) => (
          <li key={sha} className="flex h-12 items-center gap-3 px-4">
            <span className="min-w-0 flex-1 truncate">{message}</span>
            <span
              className={`w-18 shrink-0 rounded-full border py-0.5 text-center text-[11px] ${
                verified
                  ? "border-primary/40 font-medium text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {verified ? "Verified" : "Unverified"}
            </span>
            <code className="hidden font-mono text-xs text-muted-foreground sm:block">
              {sha}
            </code>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
