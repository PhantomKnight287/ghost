"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Clickable when it opens something: as a dialog trigger, the dialog passes its click handler in through `props`. */
export function StartCard({
  icon,
  title,
  description,
  ...props
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
} & React.ComponentProps<typeof Card>) {
  const interactive = Boolean(props.onClick);
  return (
    <Card
      {...props}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(event) => {
        if (interactive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      className={cn(
        "gap-3",
        interactive && "cursor-pointer transition-colors hover:bg-muted/50",
      )}
    >
      <CardHeader>
        <span className="text-muted-foreground">{icon}</span>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
