"use client";

import { useState } from "react";
import { toast } from "sonner";

/** Copies `text` to the clipboard, flagging `copied` for two seconds, or toasts `failure`. */
export function useCopy(text: string, failure: string) {
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
