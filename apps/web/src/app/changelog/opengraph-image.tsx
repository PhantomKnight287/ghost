import { ogCard, plural } from "@/lib/og";

import { CHANGELOG, DESCRIPTION, formatDate } from "./entries";

export { size, contentType } from "@/lib/og";
export const alt = "Ghost changelog";

export default function Image() {
  return ogCard({
    eyebrow: "Changelog",
    icon: "ghost",
    title: "What's new in Ghost",
    description: DESCRIPTION,
    stats: [
      { icon: "clock", label: `Updated ${formatDate(CHANGELOG[0].date)}` },
      {
        icon: "gitCommitHorizontal",
        label: plural(CHANGELOG.length, "change"),
      },
    ],
  });
}
