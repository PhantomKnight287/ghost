import { AppHeader } from "@/components/app-header";
import { getServerSession } from "@/lib/api/server";

export default async function AppsLayout({ children }: LayoutProps<"/apps">) {
  const session = await getServerSession();

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader username={session?.user.username ?? ""} />
      {children}
    </div>
  );
}
