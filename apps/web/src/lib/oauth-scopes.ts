export type ScopeGroup = "repo" | "org" | "user" | "key" | "delete" | "other";

export type ScopeDescription = {
  /** A few words, read first. */
  title: string;
  /** One sentence on what it reaches. */
  detail: string;
  group: ScopeGroup;
};

/** What each GitHub scope lets an app do, in the words a person approving it needs. Scopes Ghost does not check yet are described as GitHub grants them, so nobody approves more than they read. */
const SCOPES: Record<string, ScopeDescription> = {
  repo: {
    title: "Full access to your repositories",
    detail:
      "Read and write every repository you can, private ones included, and push to them.",
    group: "repo",
  },
  public_repo: {
    title: "Write to your public repositories",
    detail:
      "Change issues and code in your public repositories, and push to them.",
    group: "repo",
  },
  "read:org": {
    title: "See your organizations",
    detail: "The organizations you belong to, and their members.",
    group: "org",
  },
  "write:org": {
    title: "Manage organization members",
    detail: "Invite and remove members of organizations you administer.",
    group: "org",
  },
  "admin:org": {
    title: "Administer your organizations",
    detail: "Full control of the organizations you administer.",
    group: "org",
  },
  user: {
    title: "Read and change your profile",
    detail: "Your profile, and the email addresses on your account.",
    group: "user",
  },
  "read:user": {
    title: "Read your profile",
    detail: "Your name, username and other profile details.",
    group: "user",
  },
  "user:email": {
    title: "See your email addresses",
    detail: "Every address on your account, private ones included.",
    group: "user",
  },
  "read:public_key": {
    title: "See your SSH keys",
    detail: "The public keys you push and pull with.",
    group: "key",
  },
  "write:public_key": {
    title: "Add SSH keys",
    detail: "Add a key that can then push and pull as you.",
    group: "key",
  },
  "admin:public_key": {
    title: "Manage your SSH keys",
    detail: "See, add and remove the keys that push and pull as you.",
    group: "key",
  },
  delete_repo: {
    title: "Delete repositories",
    detail: "Permanently delete repositories you administer.",
    group: "delete",
  },
  gist: {
    title: "Create gists",
    detail: "Ghost has no gists, so this grants nothing here.",
    group: "other",
  },
};

export function describeScope(scope: string): ScopeDescription {
  return (
    SCOPES[scope] ?? {
      title: scope,
      detail: "Not used by Ghost.",
      group: "other",
    }
  );
}
