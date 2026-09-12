import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function LabelBadge({
  label,
  className,
}: {
  label: { name: string; color: string; description?: string | null };
  className?: string;
}) {
  return (
    <Badge
      className={cn("rounded-full border font-normal text-white!", className)}
      style={{
        backgroundColor: `#${label.color}22`,
        borderColor: `#${label.color}66`,
      }}
      title={label.description ?? undefined}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: `#${label.color}` }}
      />
      {label.name}
    </Badge>
  );
}
