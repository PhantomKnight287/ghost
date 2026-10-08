import { ogCard } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Ghost";

export default function Image() {
  return ogCard({
    eyebrow: "Git hosting · Code review · Self-hostable",
    title: "Hosted by us. Or by you.",
    description:
      "Pull requests, issues, releases and code search on a host you can also run yourself.",
    stats: [
      { icon: "gitPullRequest", label: "Code review" },
      { icon: "search", label: "Code search" },
      { icon: "tag", label: "Releases" },
      { icon: "user", label: "Teams" },
    ],
  });
}
