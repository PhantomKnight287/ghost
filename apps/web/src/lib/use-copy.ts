"use client";

import { useState } from "react";
import { toast } from "sonner";

/** Copies `text` to the clipboard, flagging `copied` for two seconds and resolving true, or toasts `failure`. A function is read at the moment of copying, for text only the browser knows, such as the page's own URL. */
export function useCopy(text: string | (() => string), failure: string) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        typeof text === "function" ? text() : text,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      toast.error(failure);
      return false;
    }
  }

  return { copied, copy };
}
