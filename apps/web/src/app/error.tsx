"use client";

import Link from "next/link";

import { ErrorPage } from "@/components/error-page";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPage
      status={500}
      title="Something went wrong"
      description="The page failed to load. Trying again often works."
      digest={error.digest}
    >
      <Button onClick={retry}>Try again</Button>
      <Button asChild variant="outline">
        <Link href="/">Go home</Link>
      </Button>
    </ErrorPage>
  );
}
