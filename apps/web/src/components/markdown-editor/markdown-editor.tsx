"use client";

import { useDebouncedValue } from "@tanstack/react-pacer";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Bold,
  Code,
  GitPullRequest,
  Heading,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  CircleDot,
  Paperclip,
  Quote,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiErrorMessage } from "@/lib/api/client";
import {
  completeMention,
  type Edit,
  type Format,
  formatEdit,
  type Mention,
  mentionAt,
  uploadPlaceholder,
} from "@/lib/markdown-editor";
import { suggestIssues, suggestUsers } from "@/lib/suggestions";
import { cn } from "@/lib/utils";
import { uploadAttachment } from "./upload-attachment";

const TOOLBAR: [Format, LucideIcon, string][][] = [
  [
    ["heading", Heading, "Heading"],
    ["bold", Bold, "Bold (⌘B)"],
    ["italic", Italic, "Italic (⌘I)"],
  ],
  [
    ["quote", Quote, "Quote"],
    ["code", Code, "Code (⌘E)"],
    ["link", Link, "Link (⌘K)"],
  ],
  [
    ["bulleted", List, "Bulleted list (⌘⇧8)"],
    ["numbered", ListOrdered, "Numbered list (⌘⇧7)"],
    ["task", ListChecks, "Task list"],
  ],
];

const SHORTCUTS: Record<string, Format> = {
  KeyB: "bold",
  KeyI: "italic",
  KeyE: "code",
  KeyK: "link",
  "Shift+Digit8": "bulleted",
  "Shift+Digit7": "numbered",
};

type Suggestion =
  | Awaited<ReturnType<typeof suggestUsers>>[number]
  | Awaited<ReturnType<typeof suggestIssues>>[number];

/** What completing to `suggestion` types after its `@` or `#`. */
const completionOf = (suggestion: Suggestion) =>
  "username" in suggestion ? suggestion.username : String(suggestion.number);

/** The one place Ghost takes Markdown: Write and Preview tabs, a formatting toolbar and shortcuts, `@` and `#` completion, and files attached by dropping, pasting or picking them. */
export function MarkdownEditor({
  value,
  onChange,
  repository,
  id,
  placeholder = "Markdown is supported.",
  rows = 4,
  maxLength = 20000,
  disabled = false,
  autoFocus = false,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Where the text will live: previews link its references, `@` and `#` complete from it, and files are attached to it. */
  repository: { username: string; repo: string };
  id?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("write");
  const [mention, setMention] = useState<Mention | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [uploads, setUploads] = useState(0);
  const [dragging, setDragging] = useState(false);

  const [typed] = useDebouncedValue(
    mention ? `${mention.trigger}${mention.query}` : "",
    { wait: 150 },
  );
  const { data: suggestions = [] } = useQuery({
    queryKey: [
      "markdown-suggestions",
      repository.username,
      repository.repo,
      typed,
    ],
    enabled: Boolean(mention) && Boolean(typed),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // `@…` lists people, `#…` issues and pull requests
    queryFn: (): Promise<Suggestion[]> =>
      typed.startsWith("@")
        ? suggestUsers(repository, typed.slice(1))
        : suggestIssues(repository, typed.slice(1)),
  });
  // the list for the last thing typed stays up while the next loads, but never under the other trigger
  const open =
    mention !== null &&
    suggestions.length > 0 &&
    "username" in suggestions[0] === (mention.trigger === "@");

  /** Applies an edit through the browser's own editing, so ⌘Z undoes it like typing. */
  function apply(edit: Edit) {
    const element = textarea.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(edit.start, edit.end);
    if (!document.execCommand("insertText", false, edit.insert)) {
      element.setRangeText(edit.insert);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    trackMention(element);
  }

  function format(as: Format) {
    const element = textarea.current;
    if (!element) return;
    apply(
      formatEdit(
        element.value,
        element.selectionStart,
        element.selectionEnd,
        as,
      ),
    );
  }

  function trackMention(element: HTMLTextAreaElement) {
    const next =
      element.selectionStart === element.selectionEnd
        ? mentionAt(element.value, element.selectionStart)
        : null;
    setMention(next);
    if (next?.start !== mention?.start) setHighlighted(0);
  }

  function complete(suggestion: Suggestion) {
    const element = textarea.current;
    if (!element || !mention) return;
    apply(
      completeMention(
        element.value,
        mention,
        element.selectionStart,
        completionOf(suggestion),
      ),
    );
    setMention(null);
  }

  /** Swaps a placeholder for what replaced it without moving the caret, wherever the person has typed since. */
  function replacePlaceholder(placeholder: string, replacement: string) {
    const element = textarea.current;
    const at = element?.value.indexOf(placeholder) ?? -1;
    if (!element || at === -1) return;
    element.setRangeText(replacement, at, at + placeholder.length, "preserve");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function attach(files: File[]) {
    const element = textarea.current;
    if (!element || files.length === 0) return;
    setTab("write");
    const placeholders = files.map((file) => uploadPlaceholder(file.name));
    const before = element.value.slice(0, element.selectionStart);
    const lead = before && !before.endsWith("\n") ? "\n" : "";
    apply({
      start: element.selectionStart,
      end: element.selectionEnd,
      insert: `${lead}${placeholders.join("\n")}\n`,
      selectionStart:
        element.selectionStart +
        lead.length +
        placeholders.join("\n").length +
        1,
      selectionEnd:
        element.selectionStart +
        lead.length +
        placeholders.join("\n").length +
        1,
    });

    setUploads((count) => count + files.length);
    files.forEach((file, index) => {
      uploadAttachment({ ...repository, file })
        .then((markdown) => replacePlaceholder(placeholders[index], markdown))
        .catch((error: unknown) => {
          replacePlaceholder(placeholders[index], "");
          toast.error(apiErrorMessage(error, `Could not attach ${file.name}.`));
        })
        .finally(() => setUploads((count) => count - 1));
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step) {
        event.preventDefault();
        setHighlighted(
          (index) => (index + step + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        complete(suggestions[Math.min(highlighted, suggestions.length - 1)]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }

    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }
    const shortcut =
      SHORTCUTS[event.shiftKey ? `Shift+${event.code}` : event.code];
    if (shortcut) {
      event.preventDefault();
      format(shortcut);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-input transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
        invalid && "border-destructive ring-3 ring-destructive/20",
        dragging && "border-primary bg-primary/5",
      )}
      onDragOver={(event) => {
        if (disabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        if (disabled || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        attach([...event.dataTransfer.files]);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "write" && (
          <div
            className="flex flex-wrap items-center gap-0.5"
            role="toolbar"
            aria-label="Formatting"
          >
            {TOOLBAR.map((group, index) => (
              <div
                key={index}
                className="flex items-center gap-0.5 not-first:border-l not-first:pl-0.5"
              >
                {group.map(([as, Icon, label]) => (
                  <Button
                    key={as}
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title={label}
                    aria-label={label}
                    disabled={disabled}
                    // keep the selection the button acts on
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => format(as)}
                  >
                    <Icon />
                  </Button>
                ))}
              </div>
            ))}
            <div className="flex items-center border-l pl-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="Attach files"
                aria-label="Attach files"
                disabled={disabled}
                onClick={() => picker.current?.click()}
              >
                <Paperclip />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <textarea
          ref={(element) => {
            textarea.current = element;
            // A post must not go out with an upload's placeholder in it; the form's own validation holds it back.
            element?.setCustomValidity(
              uploads > 0 ? "Wait for your files to finish uploading." : "",
            );
          }}
          id={id}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            trackMention(event.target);
          }}
          onSelect={(event) => trackMention(event.currentTarget)}
          onBlur={() => setMention(null)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            attach(files);
          }}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={invalid}
          className={cn(
            "field-sizing-content block max-h-[60vh] w-full resize-y bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            // hidden rather than unmounted, so uploads finishing during a preview still find their placeholders
            tab !== "write" && "hidden",
          )}
          style={{ minHeight: `calc(${rows} * 1.5em + 1rem)` }}
        />

        {open && tab === "write" && (
          <ul
            role="listbox"
            className="absolute inset-x-2 top-full z-50 mt-1 max-w-sm overflow-hidden rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={completionOf(suggestion)}
                role="option"
                aria-selected={index === highlighted}
                className={cn(
                  "flex cursor-default items-center gap-2 rounded-md px-2 py-1",
                  index === highlighted && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setHighlighted(index)}
                // before the textarea's blur closes the list
                onMouseDown={(event) => {
                  event.preventDefault();
                  complete(suggestion);
                }}
              >
                {"username" in suggestion ? (
                  <>
                    <Avatar className="size-5">
                      {suggestion.image && (
                        <AvatarImage src={suggestion.image} alt="" />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {suggestion.username.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{suggestion.username}</span>
                    <span className="truncate text-muted-foreground">
                      {suggestion.name}
                    </span>
                  </>
                ) : (
                  <>
                    {suggestion.isPullRequest ? (
                      <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <CircleDot className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-medium">#{suggestion.number}</span>
                    <span className="truncate text-muted-foreground">
                      {suggestion.title}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {tab === "preview" && (
        <div className="min-h-24 px-3 py-2 text-sm">
          {value.trim() ? (
            <Markdown repository={repository}>{value}</Markdown>
          ) : (
            <p className="text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
        <span>
          {uploads > 0
            ? `Uploading ${uploads} ${uploads === 1 ? "file" : "files"}…`
            : "Attach files by dragging, pasting or "}
          {uploads === 0 && (
            <button
              type="button"
              className="text-primary hover:underline disabled:opacity-50"
              disabled={disabled}
              onClick={() => picker.current?.click()}
            >
              selecting them
            </button>
          )}
        </span>
        <span>Markdown supported</span>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            attach([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
