import { StorageSettings } from "@/components/auth/settings/storage/storage-settings";

export default async function OrganizationStoragePage({
  params,
}: PageProps<"/[username]/settings/storage">) {
  const { username: slug } = await params;
  return <StorageSettings owner={slug} />;
}
