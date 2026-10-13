"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ErrorPage } from "@/components/error-page";
import { Button } from "@/components/ui/button";

export default function Unauthorized() {
  const pathname = usePathname();

  return (
    <ErrorPage
      status={401}
      title="Sign in to continue"
      description="This page is only for signed-in accounts."
    >
      <Button asChild>
        <Link href={`/auth/sign-in?redirectTo=${encodeURIComponent(pathname)}`}>
          Sign in
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/">Go home</Link>
      </Button>
    </ErrorPage>
  );
}
