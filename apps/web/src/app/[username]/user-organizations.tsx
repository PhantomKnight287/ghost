import { createServerClient } from "@/lib/api/server";

import { PeopleList, PersonCard } from "./people-list";

/** Membership is private, so another user's list holds only the organizations the viewer shares with them. */
export async function UserOrganizations({
  username,
  isViewer,
}: {
  username: string;
  isViewer: boolean;
}) {
  const client = await createServerClient();
  const { data } = await client.GET("/api/users/{username}/organizations", {
    params: { path: { username } },
  });

  return (
    <PeopleList
      empty={
        isViewer
          ? "You aren't a member of any organizations."
          : `You share no organizations with ${username}.`
      }
    >
      {(data?.organizations ?? []).map((organization) => (
        <PersonCard
          key={organization.slug}
          handle={organization.slug}
          name={organization.name}
          image={organization.logo}
          square
        />
      ))}
    </PeopleList>
  );
}
