"use client";

import { Check, Code2, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function ClonePopover({ cloneUrl }: { cloneUrl: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Code2 data-icon="inline-start" />
          Code
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Clone</p>
          <CloneUrlField cloneUrl={cloneUrl} />
          <p className="text-xs text-muted-foreground">
            Use this URL with <code>git clone</code>, or add it as a remote to
            an existing repository.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CloneUrlField({ cloneUrl }: { cloneUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(cloneUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the clone URL.");
    }
  }

  return (
    <InputGroup>
      <InputGroupInput readOnly value={cloneUrl} aria-label="Clone URL" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Copy clone URL"
          onClick={copy}
        >
          {copied ? <Check /> : <Copy />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
