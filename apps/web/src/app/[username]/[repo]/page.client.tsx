"use client";

import { useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export function RepositoryTabs({
  code,
  rev,
  branches,
}: {
  code: ReactNode;
  branches?: string[];
  /** Branch name or commit sha the page is showing. */
  rev: string | null;
}) {
  const router = useRouter();
  const { username, repo } = useParams<{ username: string; repo: string }>();

  // a sha is a valid revision but never an option in the list, so it shows as
  // a label on the trigger instead of a selected item
  const onBranch = rev != null && (branches ?? []).includes(rev);

  return (
    <div className="flex flex-row items-center justify-between w-full">
      <Tabs defaultValue="code" className="w-full">
        <div className="flex flex-row items-start">
          <Select
            value={onBranch ? rev : ""}
            onValueChange={(branch) =>
              router.push(
                `/${username}/${repo}/tree/${encodeURIComponent(branch)}`,
              )
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue
                placeholder={
                  rev && !onBranch ? rev.slice(0, 7) : "Select a branch"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(branches ?? []).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <TabsList className="ml-auto">
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="issues">Issues</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="code" className="flex flex-col gap-6 pt-6">
          {code}
        </TabsContent>

        <TabsContent value="issues" className="pt-6">
          <p className="text-sm text-muted-foreground">
            There aren&apos;t any issues yet.
          </p>
        </TabsContent>

        <TabsContent value="settings" className="pt-6">
          <p className="text-sm text-muted-foreground">
            Repository settings will live here.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
