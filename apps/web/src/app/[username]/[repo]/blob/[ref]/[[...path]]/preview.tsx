import { Download } from "lucide-react";

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

export function Preview({ url, filename }: { url: string; filename: string }) {
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
