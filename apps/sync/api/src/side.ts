export type Side = "ghost"|"github"

export function other(side: Side): Side{
  if (side === "ghost") return "github"
  return "ghost"
}

export const SIDE_NAME: Record<Side, "Ghost" | "GitHub"> = {
  ghost: "Ghost",
  github:"GitHub"
}
