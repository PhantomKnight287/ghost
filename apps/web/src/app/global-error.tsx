"use client";

import "./globals.css";

import { ErrorPage } from "@/components/error-page";
import { Button } from "@/components/ui/button";

/** Replaces the root layout when the layout itself fails, so it brings its own document and styles; the theme provider is gone with the layout. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <ErrorPage
          status={500}
          title="Something went wrong"
          description="Ghost failed to load. Trying again often works."
          digest={error.digest}
        >
          <Button onClick={retry}>Try again</Button>
          {/* a plain link: client navigation would reuse the layout that just failed */}
          <Button asChild variant="outline">
            <a href="/">Go home</a>
          </Button>
        </ErrorPage>
      </body>
    </html>
  );
}
