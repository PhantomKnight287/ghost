import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

// we override some default tagNames to offer some flexibility
const SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // `target` and `rel` are kept so a README can open a link in a new tab;
    // the anchor component below is what makes `_blank` safe.
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["target", "_blank", "_self", "_parent", "_top"],
      "rel",
    ],
    // `align` on a cell is turned into `style="text-align:<value>"` after
    // sanitizing, so an unconstrained value is a CSS injection: `align="right;
    // position:fixed;inset:0"` becomes a full-page overlay. Pinning it to the
    // four legal values closes that, here rather than downstream, because this
    // is the last place the value is still an attribute.
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

export function Markdown({
  children,
  className,
  resolveUrl,
}: {
  children: string;
  className?: string;
  resolveUrl?: (url: string, key: string) => string;
}) {
  return (
    <div
      className={cn(
        "text-sm wrap-break-word",
        "[&_p]:block",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_a]:text-primary [&_a]:underline",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-muted/50 [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-4 [&_hr]:border-t",
        "[&_img]:max-w-full [&_img]:rounded",
        "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1",
        "[&_li:has(input)]:list-none [&_li_input]:mr-1.5 [&_ul:has(input)]:pl-1",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
        components={{
          a({ node, className, target, rel, ...props }) {
            return (
              <a
                {...props}
                target={target}
                rel={target === "_blank" ? noopener(rel) : rel}
                className={cn("w-fit inline-flex", className)}
              />
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

/**
 * `rel` with `noopener noreferrer` added, keeping whatever the author wrote.
 * A `_blank` link hands the opener to the page it opens without it.
 */
function noopener(rel: string | undefined) {
  return [...new Set([...(rel ?? "").split(/\s+/), "noopener", "noreferrer"])]
    .filter(Boolean)
    .join(" ");
}

/** Anything that is not an absolute URL, a protocol-relative one, or an anchor. */
function isRelative(url: string) {
  return url !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
}
