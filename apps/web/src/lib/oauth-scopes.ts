/** What each GitHub scope lets an app do, in the words a person approving it needs. Scopes Ghost does not check yet are described as GitHub grants them, so nobody approves more than they read. */
const SCOPES: Record<string, string> = {
  repo: "Read and write all your repositories, private ones included, and push to them",
  public_repo: "Write to your public repositories, and push to them",
  "read:org": "See the organizations you belong to and their members",
  "write:org": "Manage the members of organizations you administer",
  "admin:org": "Fully manage the organizations you administer",
  user: "Read and change your profile, and see your email addresses",
  "read:user": "Read your profile",
  "user:email": "See your email addresses",
  "read:public_key": "See your SSH keys",
  "write:public_key": "Add SSH keys to your account",
  "admin:public_key": "See, add and remove your SSH keys",
  delete_repo: "Delete repositories you administer",
  gist: "Create gists (Ghost has none, so this grants nothing)",
};

export function describeScope(scope: string) {
  return SCOPES[scope] ?? "Not used by Ghost";
}
