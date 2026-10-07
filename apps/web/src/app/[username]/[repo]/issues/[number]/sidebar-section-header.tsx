import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";

/** A sidebar section's title, with an Edit button for viewers who may change it. */
export function SidebarSectionHeader({
  title,
  onEdit,
}: {
  title: string;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      {onEdit && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onEdit}
        >
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
      )}
    </div>
  );
}
