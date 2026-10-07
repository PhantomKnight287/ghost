import type { Metadata } from "next";
import Link from "next/link";
import { Ghost } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { ThemePicker } from "@/components/theme-picker";

import { CHANGELOG, DESCRIPTION, formatDate } from "./entries";

export const metadata: Metadata = {
  title: "Changelog",
  description: DESCRIPTION,
  alternates: { canonical: "/changelog" },
  openGraph: {
    title: "Changelog",
    description: DESCRIPTION,
    url: "/changelog",
  },
};

export default function ChangelogPage() {
  return (
    <div className="flex min-h-full flex-col">
      <nav
        aria-label="Primary"
        className="mx-auto flex w-full max-w-3xl items-center px-5 py-4 md:px-10 md:py-6"
      >
        <Link
          href="/"
          className="mr-auto flex items-center gap-2.5 text-lg font-semibold tracking-tight"
        >
          <Ghost className="size-5" />
          Ghost
        </Link>
        <ThemePicker />
      </nav>

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-5 pt-8 pb-24 md:px-10 md:pt-16">
        <header className="flex flex-col gap-3">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] md:text-5xl">
            Changelog
          </h1>
          <p className="text-muted-foreground md:text-lg">{DESCRIPTION}</p>
        </header>

        {[...Map.groupBy(CHANGELOG, ({ date }) => date)].map(
          ([date, entries]) => (
            <section
              key={date}
              id={date}
              className="flex flex-col gap-6 border-t pt-8 md:flex-row md:gap-10"
            >
              <h2 className="shrink-0 text-sm font-medium text-muted-foreground md:w-40">
                <a href={`#${date}`} className="hover:text-foreground">
                  <time dateTime={date}>{formatDate(date)}</time>
                </a>
              </h2>
              <div className="flex min-w-0 flex-col gap-8">
                {entries.map(({ title, body }) => (
                  <article key={title} className="flex flex-col gap-2">
                    <h3 className="text-xl font-semibold tracking-[-0.02em]">
                      {title}
                    </h3>
                    <Markdown className="text-muted-foreground">
                      {body}
                    </Markdown>
                  </article>
                ))}
              </div>
            </section>
          ),
        )}
      </main>
    </div>
  );
}
