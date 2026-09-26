import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/** One setting: a heading, a card holding its field, and a footer that explains it and saves it. */
export function SettingCard({
  title,
  hint,
  children,
  onSubmit,
  pending,
  canSave,
  submitText = "Save",
}: {
  title: string;
  hint: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
  pending: boolean;
  canSave: boolean;
  submitText?: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Card className="gap-0 py-0">
          <CardContent className="py-6">{children}</CardContent>
          <CardFooter className="flex flex-col items-start gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{hint}</p>
            <Button type="submit" size="sm" disabled={pending || !canSave}>
              {pending && <Spinner />}
              {submitText}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </section>
  );
}
