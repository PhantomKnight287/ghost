"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** A secret Ghost shows once, with a copy button. */
export function SecretAlert({
  title,
  description,
  secret,
}: {
  title: string;
  description: ReactNode;
  secret: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the secret.");
    }
  }

  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{description}</p>
        <div className="flex w-full items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
            {secret}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copy}
            aria-label="Copy secret"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
