"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function SecretAlert({ url, secret }: { url: string; secret: string }) {
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
      <AlertTitle>Copy the signing secret for {url} now</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>
          Ghost will not show it again. Use it to check the{" "}
          <code className="font-mono text-xs">X-Ghost-Signature-256</code>{" "}
          header on each delivery.
        </p>
        <div className="flex w-full items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
            {secret}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copy}
            aria-label="Copy signing secret"
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
