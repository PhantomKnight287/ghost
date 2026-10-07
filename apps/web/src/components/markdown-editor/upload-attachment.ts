import { apiClient, apiErrorMessage } from "@/lib/api/client";
import { API_URL } from "@/lib/env";
import { attachmentMarkdown } from "@/lib/markdown-editor";

/** Sends a file's bytes straight from the browser to the API and returns the Markdown that embeds it. */
export async function uploadAttachment({
  username,
  repo,
  file,
}: {
  username: string;
  repo: string;
  file: File;
}) {
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
