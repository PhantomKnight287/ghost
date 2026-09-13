import { ogCard } from "@/lib/og";

export { size, contentType } from "@/lib/og";
export const alt = "Ghost";

export default function Image() {
  return ogCard({
    eyebrow: "git hosting",
    icon: "ghost",
    title: "Ghost",
    description: "Host your git repositories, issues and pull requests.",
  });
}
