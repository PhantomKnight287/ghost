import { notFound } from "next/navigation";
import {
  bundledLanguages,
  codeToTokens,
  type BundledLanguage,
  type ThemeRegistrationRaw,
} from "shiki";
import { formatDistanceToNow } from "date-fns";
import { Download, GitCommitHorizontal } from "lucide-react";
import pierreDark from "@pierre/theme/pierre-dark";
import pierreLight from "@pierre/theme/pierre-light";

import { createServerClient } from "@/lib/api/server";

export default async function RepositoryBlobPage({
  params,
}: PageProps<"/[username]/[repo]/blob/[ref]/[[...path]]">) {
  const { username, repo, ref, path } = await params;

  const segments = (path ?? []).map(decodeURIComponent);
  if (segments.length === 0) notFound();

  const client = await createServerClient();

  const revision = decodeURIComponent(ref);
  const filePath = segments.join("/");

  const blob = await client.GET("/api/repositories/{username}/{slug}/blob", {
    params: {
      path: { username, slug: repo },
      query: { ref: revision, path: filePath },
    },
  });

  if (blob.response.status === 404) notFound();
  if (!blob.data) throw new Error(`Failed to read ${filePath}`);

  const filename = segments.at(-1) ?? "";
  const rawUrl = `/${username}/${repo}/raw/${encodeURIComponent(revision)}/${segments
    .map(encodeURIComponent)
    .join("/")}`;

  const { commit, size, encoding, content } = blob.data;

  // a trailing newline ends the last line, it does not start another one
  const text =
    encoding === "utf-8" && content ? content.replace(/\n$/, "") : null;

  const lines = text
    ? (
        await codeToTokens(text, {
          lang: languageFor(filename),
          // the themes ship as frozen TextMate objects, which shiki loads and
          // caches by their own `name`
          themes: {
            light: pierreLight as ThemeRegistrationRaw,
            dark: pierreDark as ThemeRegistrationRaw,
          },
          defaultColor: false,
        })
      ).tokens
    : null;

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-sm">
        {commit && (
          <>
            <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{commit.message}</span>
            <code className="shrink-0 text-xs text-muted-foreground">
              {commit.sha.slice(0, 7)}
            </code>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(commit.committedAt), {
                addSuffix: true,
              })}
            </span>
          </>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {lines ? `${lines.length} lines · ` : ""}
          {formatBytes(size)}
        </span>
        <a
          href={rawUrl}
          download={filename}
          aria-label="Download file"
          className="shrink-0 text-muted-foreground hover:text-primary"
        >
          <Download className="size-4" />
        </a>
      </div>

      {lines ? (
        <div className="overflow-x-auto" data-shiki>
          <table className="w-full border-collapse font-mono text-sm">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-muted/40">
                  <td className="w-12 select-none border-r py-0.5 pr-3 text-right align-top text-xs text-muted-foreground">
                    {i + 1}
                  </td>
                  <td className="py-0.5 pl-4 whitespace-pre">
                    {line.map((t, j) => (
                      <span key={j} style={t.htmlStyle}>
                        {t.content}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Preview url={rawUrl} filename={filename} />
      )}
    </div>
  );
}

const MEDIA_KINDS: Record<string, "image" | "audio" | "video" | "pdf"> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  ico: "image",
  bmp: "image",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  pdf: "pdf",
};

// served from the raw route, so nothing here is capped by the inline size limit
function Preview({ url, filename }: { url: string; filename: string }) {
  const kind = MEDIA_KINDS[filename.toLowerCase().split(".").pop() ?? ""];

  if (kind === "image") {
    return (
      <div className="flex justify-center bg-muted/20 p-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          className="max-h-[70vh] max-w-full object-contain"
        />
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex justify-center p-8">
        <audio controls src={url} className="w-full max-w-lg" />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className="flex justify-center bg-muted/20 p-8">
        <video controls src={url} className="max-h-[70vh] max-w-full" />
      </div>
    );
  }

  if (kind === "pdf") {
    return <iframe src={url} title={filename} className="h-[80vh] w-full" />;
  }

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">
        This file cannot be displayed.
      </p>
      <a
        href={url}
        download={filename}
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
      >
        <Download className="size-4" />
        Download
      </a>
    </div>
  );
}

const LANGUAGE_BY_NAME: Record<string, BundledLanguage> = {
  dockerfile: "docker",
  makefile: "make",
  gemfile: "ruby",
  rakefile: "ruby",
};

function languageFor(filename: string): BundledLanguage | "text" {
  const name = filename.toLowerCase();
  if (name in LANGUAGE_BY_NAME) return LANGUAGE_BY_NAME[name];

  const extension = name.split(".").pop() ?? "";
  return extension in bundledLanguages
    ? (extension as BundledLanguage)
    : "text";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
