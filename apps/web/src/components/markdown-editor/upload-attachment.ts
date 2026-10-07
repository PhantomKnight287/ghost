import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { API_URL } from "@/lib/env";
import { attachmentMarkdown } from "@/lib/markdown-editor";

/** Sends a file's bytes straight from the browser to the API and returns the Markdown that embeds it. */
export async function uploadAttachment({
  username,
  repo,
  file: picked,
}: {
  username: string;
  repo: string;
  file: File;
}) {
  const file = isHeic(picked) ? await toJpeg(picked) : picked;
  const { data, error } = await apiClient.POST(
    "/api/repositories/{username}/{repo}/attachments",
    {
      params: { path: { username, repo }, query: { name: file.name } },
      // always octet-stream: the API parses JSON and form bodies before they could be streamed
      headers: { "Content-Type": "application/octet-stream" },
      body: file as unknown as string,
      bodySerializer: (body) => body,
    },
  );

  if (error) throw new Error(`${file.name}: ${apiErrorMessage(error)}`);
  return attachmentMarkdown(
    data.name,
    `${API_URL}/api/attachments/${data.id}`,
    data.contentType,
  );
}

const HEIC = /\.hei[cf]$/i;

/** iPhone photos arrive as HEIC, which only Safari can draw: anywhere else the embed would show a broken image. */
function isHeic(file: File) {
  return HEIC.test(file.name) || /^image\/hei[cf]/.test(file.type);
}

async function toJpeg(file: File) {
  // a few MB of wasm, so only fetched once someone attaches a HEIC photo
  const { heicTo } = await import("heic-to/next");
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
  return new File([jpeg], `${file.name.replace(HEIC, "")}.jpg`, {
    type: "image/jpeg",
  });
}
