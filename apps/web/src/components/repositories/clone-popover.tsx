"use client";

import { Check, Code2, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function ClonePopover({
  cloneUrl,
  sshCloneUrl,
}: {
  cloneUrl: string;
  sshCloneUrl?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Code2 data-icon="inline-start" />
          Code
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80">
        <CloneSection cloneUrl={cloneUrl} sshCloneUrl={sshCloneUrl} />
      </PopoverContent>
    </Popover>
  );
}

export function CloneSection({
  cloneUrl,
  sshCloneUrl,
}: {
  cloneUrl: string;
  sshCloneUrl?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Clone</p>
      <CloneTransports
        http={
          <>
            <CloneUrlField cloneUrl={cloneUrl} />
            <p className="text-xs text-muted-foreground">
              The password is a personal access token from account settings, not
              your login password.
            </p>
          </>
        }
        ssh={
          sshCloneUrl && (
            <>
              <CloneUrlField cloneUrl={sshCloneUrl} />
              <p className="text-xs text-muted-foreground">
                Needs an SSH key on your account. Log in as <code>git</code>;
                the key says who you are.
              </p>
            </>
          )
        }
      />
    </div>
  );
}

/** One transport, or a tab per transport. An instance with no SSH listener has nothing to switch between, so it gets the HTTP panel on its own. */
export function CloneTransports({
  http,
  ssh,
}: {
  http: ReactNode;
  ssh?: ReactNode;
}) {
  if (!ssh) return <div className="flex flex-col gap-2">{http}</div>;

  return (
    <Tabs defaultValue="http" className="gap-2">
      <TabsList className="w-full">
        <TabsTrigger value="http">HTTP</TabsTrigger>
        <TabsTrigger value="ssh">SSH</TabsTrigger>
      </TabsList>
      <TabsContent value="http" className="flex flex-col gap-2">
        {http}
      </TabsContent>
      <TabsContent value="ssh" className="flex flex-col gap-2">
        {ssh}
      </TabsContent>
    </Tabs>
  );
}

export function CloneUrlField({ cloneUrl }: { cloneUrl: string }) {
  const { copied, copy } = useCopy(cloneUrl, "Could not copy the clone URL.");

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

/** Shell commands in one block, copied together. */
export function CommandsField({ commands }: { commands: string[] }) {
  const text = commands.join("\n");
  const { copied, copy } = useCopy(text, "Could not copy the commands.");

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 pr-10 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copy commands"
        className="absolute top-2 right-2"
        onClick={copy}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

function useCopy(text: string, failure: string) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(failure);
    }
  }

  return { copied, copy };
}
