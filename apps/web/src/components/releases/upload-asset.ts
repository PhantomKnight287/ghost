import { apiClient, apiErrorMessage } from "@/lib/api/client";

/** Sends a file's bytes straight from the browser to the API, which streams them to storage. A server action would buffer the whole file and cap it at its body limit. */
export async function uploadReleaseAsset({
  username,
  repo,
  releaseId,
  file,
}: {
  username: string;
  repo: string;
  releaseId: string;
  file: File;
}) {
  const { error } = await apiClient.POST(
    "/api/repositories/{username}/{repo}/releases/{id}/assets",
    {
      params: {
        path: { username, repo, id: releaseId },
        query: { name: file.name, type: file.type || undefined },
      },
      // always octet-stream: the API parses JSON and form bodies before they could be streamed
      headers: { "Content-Type": "application/octet-stream" },
      body: file as unknown as string,
      bodySerializer: (body) => body,
    },
  );

  if (error) throw new Error(`${file.name}: ${apiErrorMessage(error)}`);
}
