import { CloneUrlField } from "@/components/repositories/clone-popover";

export function RepositoryEmptyState({
  cloneUrl,
  defaultBranch,
}: {
  cloneUrl: string;
  defaultBranch: string;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-lg border p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Quick setup</h2>
        <p className="text-sm text-muted-foreground">
          This repository is empty. Push a commit and it shows up here.
        </p>
        <CloneUrlField cloneUrl={cloneUrl} />
      </div>

      <Setup
        title="Create a new repository on the command line"
        commands={[
          'echo "# repository" >> README.md',
          "git init",
          "git add README.md",
          'git commit -m "first commit"',
          `git branch -M ${defaultBranch}`,
          `git remote add origin ${cloneUrl}`,
          `git push -u origin ${defaultBranch}`,
        ]}
      />

      <Setup
        title="Push an existing repository from the command line"
        commands={[
          `git remote add origin ${cloneUrl}`,
          `git branch -M ${defaultBranch}`,
          `git push -u origin ${defaultBranch}`,
        ]}
      />
    </div>
  );
}

function Setup({ title, commands }: { title: string; commands: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {/* one block, so selecting it copies the whole sequence */}
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
        <code>{commands.join("\n")}</code>
      </pre>
    </div>
  );
}
