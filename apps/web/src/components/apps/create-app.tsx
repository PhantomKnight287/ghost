"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

import { createApp } from "./actions";
import { AppFields, appReady, EMPTY_APP } from "./app-fields";
import { appsPath } from "./paths";

/** Register an app for the user or `organization`, then open its settings, where its first private key is generated. */
export function CreateApp({ organization }: { organization?: string }) {
  const router = useRouter();
  const base = appsPath(organization);
  const [values, setValues] = useState(EMPTY_APP);
  const create = useAction(createApp, {
    onSuccess: ({ data }) => {
      toast.success(`${data.name} is registered`);
      router.push(`${base}/${data.slug}`);
    },
    onError: ({ error }) =>
      toast.error(error.serverError ?? "Could not register this app."),
  });

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href={base}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Ghost Apps
        </Link>
        <h2 className="text-lg font-semibold">Register a new Ghost App</h2>
        <p className="text-sm text-muted-foreground">
          You can change everything but its bot&apos;s name later, and add a
          logo and private keys once the app exists.
        </p>
      </div>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.execute({ ...values, organization });
        }}
      >
        <Card className="gap-0 py-0">
          <CardContent className="py-6">
            <AppFields
              values={values}
              disabled={create.isExecuting}
              onChange={setValues}
            />
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t py-4">
            <Button variant="ghost" asChild>
              <Link href={base}>Cancel</Link>
            </Button>
            <Button
              type="submit"
              disabled={!appReady(values) || create.isExecuting}
            >
              {create.isExecuting && <Spinner />}
              Register app
            </Button>
          </CardFooter>
        </Card>
      </form>
    </section>
  );
}
