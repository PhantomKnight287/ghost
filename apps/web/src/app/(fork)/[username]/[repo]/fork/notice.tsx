import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Notice({
  message,
  href,
  action,
}: {
  message: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <p className="text-sm">{message}</p>
      <Button asChild size="sm" variant="outline">
        <Link href={href}>{action}</Link>
      </Button>
    </div>
  );
}
