import {
  Info,
  Lightbulb,
  type LucideIcon,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";

import { ALERTS, remarkAlerts, remarkBreaks } from "@/lib/remark-github";
import { remarkReferences } from "@/lib/remark-references";
import { cn } from "@/lib/utils";

// we override some default tagNames to offer some flexibility
const SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // `target` and `rel` are kept so a README can open a link in a new tab; the anchor component below is what makes `_blank` safe.
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["target", "_blank", "_self", "_parent", "_top"],
      "rel",
    ],
    // the classes `remarkAlerts` puts on an alert and its title, and nothing else
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      [
        "className",
        "markdown-alert",
        ...Object.keys(ALERTS).map((type) => `markdown-alert-${type}`),
      ],
    ],
    p: [
      ...(defaultSchema.attributes?.p ?? []),
      ["className", "markdown-alert-title"],
    ],
    // `align` becomes `style="text-align:<value>"` after sanitizing, so anything but the four legal values is a CSS injection. This is the last point where it is still an attribute.
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []).filter(
        (attribute) => attribute !== "align" && attribute !== "vAlign",
      ),
      ["align", "left", "right", "center", "justify"],
      ["vAlign", "top", "middle", "bottom", "baseline"],
    ],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "abbr",
    "caption",
    "center",
    "figcaption",
    "figure",
    "mark",
    "small",
    "time",
  ],
};

const ALERT_ICONS: Record<(typeof ALERTS)[keyof typeof ALERTS], LucideIcon> = {
  Note: Info,
  Tip: Lightbulb,
  Important: MessageSquareWarning,
  Warning: TriangleAlert,
  Caution: OctagonAlert,
};

export function Markdown({
  children,
  className,
  resolveUrl,
  repository,
}: {
  children: string;
  className?: string;
  resolveUrl?: (url: string, key: string) => string;
  /** Where issue and pull request text lives; set, `#1`, `owner/repo#1` and `@user` become links. */
  repository?: { username: string; repo: string };
}) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={
          // Issue, pull request and comment text breaks lines on every newline, as on GitHub; a README does not.
          repository
            ? [
                remarkGfm,
                remarkGemoji,
                remarkAlerts,
                remarkBreaks,
                [remarkReferences, repository],
              ]
            : [remarkGfm, remarkGemoji, remarkAlerts]
        }
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
        components={{
          a({ node, target, rel, ...props }) {
            return (
              <a
                {...props}
                target={target}
                rel={target === "_blank" ? noopener(rel) : rel}
              />
            );
          },
          p({ node, className, children, ...props }) {
            const Icon =
              className === "markdown-alert-title" &&
              ALERT_ICONS[children as (typeof ALERTS)[keyof typeof ALERTS]];
            return (
              <p {...props} className={className || undefined}>
                {Icon && <Icon aria-hidden className="size-4" />}
                {children}
              </p>
            );
          },
        }}
        urlTransform={
          resolveUrl &&
          ((url, key) => {
            const safe = defaultUrlTransform(url);
            return isRelative(safe) ? resolveUrl(safe, key) : safe;
          })
        }
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** `rel` with `noopener noreferrer` added, keeping whatever the author wrote. A `_blank` link hands the opener to the page it opens without it. */
function noopener(rel: string | undefined) {
  return [...new Set([...(rel ?? "").split(/\s+/), "noopener", "noreferrer"])]
    .filter(Boolean)
    .join(" ");
}

/** Anything that is not an absolute URL, a protocol-relative one, or an anchor. */
function isRelative(url: string) {
  return url !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
}
