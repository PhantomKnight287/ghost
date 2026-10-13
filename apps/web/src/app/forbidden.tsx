import Link from "next/link";

import { ErrorPage } from "@/components/error-page";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <ErrorPage
      status={403}
      title="You do not have access"
      description="Your account cannot open this page. Ask an owner or admin if you need it."
    >
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </ErrorPage>
  );
}
