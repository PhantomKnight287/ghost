import { ArrowRight, Check, Ghost } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ThemePicker } from "@/components/theme-picker";
import { Button } from "@/components/ui/button";

import { getServerSession } from "@/lib/api/server";
import { DOCS_URL } from "@/lib/env";

const FEATURES = [
  {
    title: "Your history survives a bad day.",
    body: "Every push is backed up the moment it lands. If a server goes down, your code doesn’t go with it.",
  },
  {
    title: "Stop asking where that code lives.",
    body: "Search every repository you can read at once. New code shows up as soon as it’s pushed.",
  },
  {
    title: "Give access without giving away the keys.",
    body: "Organizations and teams, with the right access for each person. A contractor sees one repository. Everyone else sees nothing.",
  },
  {
    title: "Know which commits are really yours.",
    body: "Sign commits with your GPG key and Ghost marks them Verified, where everyone can see it.",
  },
];

const ALSO = [
  "Issues, labels and assignees",
  "#123 cross references",
  "Merge, squash or rebase",
  "Tags and releases",
  "Forks and stars",
  "Highlighting for 300+ languages",
  "Language breakdown",
  "Contribution graph",
  "Notifications",
];

export default async function LandingPage() {
  const session = await getServerSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-7xl items-center gap-1 px-5 py-4 md:px-10 md:py-6"
      >
        <span className="mr-auto flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <Ghost className="size-5" />
          Ghost
        </span>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden rounded-full text-muted-foreground md:inline-flex"
        >
          <a href={DOCS_URL}>Docs</a>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden rounded-full text-muted-foreground md:inline-flex"
        >
          <a href={DOCS_URL}>Self-host</a>
        </Button>
        <ThemePicker />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full px-2.5 md:px-3"
        >
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
        <Button
          asChild
          size="sm"
          className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        >
          <Link href="/auth/sign-up">Create account</Link>
        </Button>
      </nav>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-5 md:px-10">
        <section className="flex flex-col gap-6 pt-12 md:gap-10 md:pt-24">
          <p className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.06em] text-primary uppercase md:text-[13px] md:tracking-[0.08em]">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            Git hosting · Pull requests · Code review
          </p>
          <h1 className="max-w-[11ch] text-[46px] leading-none font-semibold tracking-[-0.05em] text-balance md:max-w-5xl md:text-8xl md:leading-[0.96]">
            Keep shipping when GitHub is down.
          </h1>
          <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <p className="max-w-lg text-[17px] leading-relaxed text-pretty text-muted-foreground md:text-xl">
              Pull requests, reviews, issues and search on a host that
              isn&rsquo;t having an outage today. Use ours, or run it yourself.
            </p>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-13 rounded-full px-6 text-base"
              >
                <Link href="/auth/sign-up">
                  Create an account
                  <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-13 rounded-full px-6 text-base"
              >
                <a href={DOCS_URL}>Self-host it</a>
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-24 hidden overflow-hidden rounded-[28px] bg-accent px-16 pt-16 md:block">
          <Image
            src="/landing/pull-request.png"
            alt="A pull request in Ghost showing a split diff of a workflow file"
            width={2296}
            height={1640}
            priority
            className="rounded-t-xl border border-b-0 shadow-[0_30px_60px_-30px_oklch(0_0_0/0.25)]"
          />
        </section>

        <section className="flex flex-col gap-9 pt-24 md:pt-40 lg:flex-row lg:justify-between lg:gap-16">
          <div className="flex flex-col gap-4 md:max-w-md md:gap-5 lg:max-w-sm">
            <h2 className="text-4xl font-semibold tracking-[-0.04em] text-balance md:text-[52px] md:leading-[1.04]">
              Everything you use daily. Minus the outages.
            </h2>
            <p className="leading-relaxed text-pretty text-muted-foreground md:text-[17px]">
              Same git, same pull requests, same reviews. Change the remote and
              keep working.
            </p>
          </div>
          <ol className="flex min-w-0 flex-col lg:flex-1 xl:w-[720px] xl:flex-none">
            {FEATURES.map(({ title, body }, index) => (
              <li
                key={title}
                className="flex border-b py-6 first:pt-1 md:py-8 md:first:pt-2.5"
              >
                <span className="w-10 shrink-0 font-mono text-[13px] leading-[25px] text-muted-foreground md:w-18 md:text-sm md:leading-7">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-xl leading-[25px] font-semibold tracking-[-0.02em] md:text-2xl md:leading-7">
                    {title}
                  </h3>
                  <p className="text-[15px] leading-[23px] text-pretty text-muted-foreground md:text-base md:leading-[25px]">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="hidden gap-6 pt-30 md:flex">
          <ScreenCard
            src="/landing/commits.png"
            alt="Commit history with Verified and Unverified signature badges"
            anchor="right"
            title="Verified, or not"
            body="See at a glance which commits are really signed."
          />
          <ScreenCard
            src="/landing/repository.png"
            alt="A repository page listing folders with their latest commits"
            anchor="left"
            title="Browse any branch"
            body="Files, latest changes, releases and languages in one view."
          />
        </section>

        <section className="-mx-2 pt-24 md:mx-0 md:pt-40">
          <div className="relative flex flex-col gap-8 overflow-hidden rounded-3xl bg-foreground px-5 pt-10 pb-5 text-background md:gap-14 md:rounded-[28px] md:p-20">
            <div
              aria-hidden
              className="absolute -top-44 -right-44 size-[420px] rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--primary)_35%,transparent)_0%,transparent_65%)] md:-top-56 md:-right-40 md:size-[720px]"
            />
            <div className="relative flex flex-col gap-4 px-2 md:px-0 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
              <div className="flex flex-col gap-4 md:shrink-0">
                <p className="font-mono text-[13px] tracking-[0.08em] text-background/60 uppercase">
                  Two ways to run it
                </p>
                <h2 className="text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] md:text-[56px] md:leading-none xl:text-[64px]">
                  Hosted by us. Or by you.
                </h2>
              </div>
              <p className="leading-relaxed text-background/70 md:max-w-md md:text-lg lg:max-w-xs">
                Same Ghost either way. Start on ours today, or run it on your
                own server.
              </p>
            </div>
            <div className="relative flex flex-col gap-3 md:flex-row md:gap-5">
              <Plan
                label="Ghost Cloud"
                tag="Recommended"
                title="We run it."
                body="Sign up, add a remote, push. Nothing to install."
                points={[
                  "Ready in about a minute",
                  "Updates handled for you",
                  "Invite your team on day one",
                ]}
                featured
              >
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-background px-5 text-base text-foreground hover:bg-background/90"
                >
                  <Link href="/auth/sign-up">
                    Create an account
                    <ArrowRight />
                  </Link>
                </Button>
              </Plan>
              <Plan
                label="Self-hosted"
                tag="Your server"
                title="You run it."
                body="The same app on hardware you control."
                points={[
                  "Your network, your rules",
                  "Every feature Cloud has",
                  "Bring your repositories over with a git push",
                ]}
              >
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-background/20 bg-transparent px-5 text-base text-background hover:bg-background/10 hover:text-background"
                >
                  <a href={DOCS_URL}>Read the self-hosting guide</a>
                </Button>
              </Plan>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-5 pt-24 md:gap-8 md:pt-40">
          <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] md:text-[32px]">
            Plus the things you reach for daily.
          </h2>
          <ul className="flex max-w-5xl flex-wrap gap-2 md:gap-2.5">
            {ALSO.map((item) => (
              <li
                key={item}
                className="rounded-full border px-3.5 py-2 text-sm md:px-4.5 md:py-2.5 md:text-base"
              >
                {item}
              </li>
            ))}
            <li className="rounded-full bg-accent px-3.5 py-2 text-sm text-accent-foreground md:px-4.5 md:py-2.5 md:text-base">
              Light, dark and custom themes
            </li>
          </ul>
        </section>

        <section className="relative flex flex-col items-start gap-7 pt-30 pb-24 md:gap-9 md:pt-50 md:pb-40">
          <Ghost
            aria-hidden
            strokeWidth={1.25}
            className="absolute top-36 right-0 hidden size-90 rotate-8 fill-primary/10 text-primary lg:block"
          />
          <p className="max-w-[18ch] text-[40px] leading-[1.05] font-semibold tracking-[-0.05em] text-balance md:max-w-[14ch] md:text-[88px] md:leading-[0.98]">
            Change the remote. Keep the workflow.
          </p>
          <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3.5">
            <Button
              asChild
              size="lg"
              className="h-13 rounded-full px-6 text-base"
            >
              <Link href="/auth/sign-up">
                Create an account
                <ArrowRight />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="link"
              className="h-13 px-1 text-base text-foreground sm:px-5"
            >
              <a href={DOCS_URL}>Read the self-hosting guide</a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 px-5 pt-7 pb-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:px-10 md:pt-8">
          <span className="flex items-center gap-2">
            <Ghost className="size-4 text-foreground" />
            <span className="font-semibold text-foreground">Ghost</span>
            <span>— git hosting for teams that ship</span>
          </span>
          <div className="flex gap-5 md:gap-7">
            <a href={DOCS_URL} className="hover:text-foreground">
              Docs
            </a>
            <a href={DOCS_URL} className="hover:text-foreground">
              Self-hosting
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ScreenCard({
  src,
  alt,
  anchor,
  title,
  body,
}: {
  src: string;
  alt: string;
  /** Which edge of the screenshot stays in view; the other edge bleeds off the card. */
  anchor: "left" | "right";
  title: string;
  body: string;
}) {
  return (
    <figure className="group flex min-w-0 flex-1 flex-col gap-4.5">
      <div className="relative h-[420px] overflow-hidden rounded-2xl border bg-accent">
        <Image
          src={src}
          alt={alt}
          width={2296}
          height={1640}
          sizes="800px"
          className={`absolute top-10 w-[800px] max-w-none border shadow-[0_20px_40px_-20px_oklch(0_0_0/0.28)] transition-transform duration-200 ease-out group-hover:-translate-y-2 ${
            anchor === "right"
              ? "right-10 rounded-tr-xl border-l-0"
              : "left-10 rounded-tl-xl border-r-0"
          }`}
        />
      </div>
      <figcaption className="flex flex-col gap-1">
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-[15px] text-muted-foreground">{body}</span>
      </figcaption>
    </figure>
  );
}

function Plan({
  label,
  tag,
  title,
  body,
  points,
  featured = false,
  children,
}: {
  label: string;
  tag: string;
  title: string;
  body: string;
  points: string[];
  featured?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative flex min-w-0 flex-1 flex-col gap-7 overflow-hidden rounded-[22px] px-6 py-7 md:gap-10 md:p-10 ${
        featured
          ? "bg-primary text-primary-foreground"
          : "border border-background/15 bg-background/5"
      }`}
    >
      {featured && (
        <Ghost
          aria-hidden
          strokeWidth={0.5}
          className="absolute -right-8 -bottom-10 hidden size-60 -rotate-10 fill-primary-foreground/10 text-primary-foreground/20 md:block"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-mono text-xs tracking-[0.08em] uppercase ${featured ? "opacity-85" : "text-background/60"}`}
        >
          {label}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-[13px] font-medium ${
            featured
              ? "bg-primary-foreground text-primary"
              : "border border-background/20 text-background/70"
          }`}
        >
          {tag}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.035em] md:text-[40px]">
          {title}
        </h3>
        <p className="leading-relaxed opacity-80 md:text-[17px]">{body}</p>
      </div>
      <ul className="flex flex-col gap-3.5">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-3">
            <Check
              aria-hidden
              strokeWidth={2.4}
              className={`size-4.5 shrink-0 ${featured ? "" : "text-background/60"}`}
            />
            {point}
          </li>
        ))}
      </ul>
      <div className="relative">{children}</div>
    </div>
  );
}
