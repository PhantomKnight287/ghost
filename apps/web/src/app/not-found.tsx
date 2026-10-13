import Link from "next/link";

import { ErrorPage } from "@/components/error-page";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <ErrorPage
      status={404}
      title="Page not found"
      // a private repository answers 404 too, so the wording cannot say the page does not exist
      description="There is nothing here, or it is not yours to see. Check the address, or sign in with an account that has access."
    >
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </ErrorPage>
  );
}
