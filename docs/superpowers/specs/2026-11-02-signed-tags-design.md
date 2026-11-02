# Verify signed tags

Issue: #100 on Ghost. Split out of #60, which ships SSH signing for commits only.

## Intent

GitHub shows whether a signed annotated tag is verified on its tags and releases pages. Ghost already does this for commits (`CommitVerificationService`) but shows nothing for tags. This work closes the gap. It also makes Ghost sign the release tags it creates, so tags Ghost writes carry a "Signed by Ghost" badge the way its merge commits do.

## Goals

1. Read the signature on an annotated tag object, OpenPGP (`-----BEGIN PGP SIGNATURE-----`) or SSH (`-----BEGIN SSH SIGNATURE-----`).
2. Verify it with the same key lookups, states and reasons as commits. The address checked is the tagger's email, where commits check the author's.
3. Ghost signs the tag objects it creates for releases with its own key (`COMMIT_SIGNING_KEY`). Those tags verify as `Signed by Ghost`, without the tagger email check, the same rule as Ghost-signed commits.
4. Ghost's own API returns the verdict on every tag in the tags list and on releases.
5. The GitHub-compatible REST API serves `GET /api/v3/repos/{owner}/{repo}/git/tags/{tag_sha}` with GitHub's shape, `verification` included.
6. The web app shows the verification badge on the tags page, the release page and the releases list.
7. Lightweight tags show no badge, as on GitHub.
8. GraphQL serves tags in GitHub's shape: `Repository.ref`, `Repository.refs`, `Release.tag`, `Ref.target`, a `Tag` type, and `Commit.signature`. GitHub's `Tag` type has no `signature` field (checked against `@octokit/graphql-schema` 15.26.1), so a tag's own verdict does not appear in GraphQL. `Commit.signature` covers the commit a tag points at.

## Non-goals

- A `signature` field on GraphQL `Tag`. GitHub has none, and Ghost does not add fields GitHub lacks.
- X.509 (`gpgsm`) signatures. Commits ignore them too.
- Renaming `COMMIT_SIGNING_KEY` even though it now signs tags. Renaming costs a config change on Railway for no gain.
- A badge on the latest-release card in the repository sidebar.
- Signing tags Ghost does not create. Tags pushed over git keep whatever signature they were pushed with.
- `POST /git/tags` (creating tag objects through the REST API).

## Anti-goals

- **A badge that vouches for the wrong person.** As with commits, holding a key proves who signed, never who tagged. A user-signed tag must be checked against the tagger email. Only a platform key (GitHub's or Ghost's) skips that check.
- **A stored verdict.** Verify on read, like commits. Keys and verified emails change after a tag is pushed.
- **A second, diverging verifier.** Tags go through the same judging code as commits. Two copies of the rules would drift.
- **A release that fails because signing failed.** Without `COMMIT_SIGNING_KEY` the tag is written unsigned, as merges are today.

## How it works (decided)

### Reading the signature

A signed tag object looks like this:

```
object <sha>
type commit
tag v1.0.0
tagger Name <email> 1700000000 +0000

message
-----BEGIN PGP SIGNATURE-----
...
-----END PGP SIGNATURE-----
```

Unlike a commit, the signature is not a header. It is the trailing block of the message. The signed payload is every byte of the object before the line `-----BEGIN PGP SIGNATURE-----` or `-----BEGIN SSH SIGNATURE-----`. The signature is that line through the end of the object. When more than one such line appears, the last one starts the signature, as in git's `parse_signature`.

The batch reader in `lib/git/commits/commit-signature.ts` (`readSignedCommits`) handles objects of type `tag` too. It splits them with the trailing-block rule above, and commits keep the header rule.

### Verifying

`CommitVerificationService` verifies tag objects with the same code as commits. The caller passes the tag object sha and the tagger email in the slot where commits pass the author email.

The **tagger** is the `tagger Name <email> <timestamp> <zone>` header of an annotated tag object: who made the tag, filled by git from `user.name` / `user.email` at `git tag -a` / `git tag -s`. It is the tag's counterpart of a commit's author. For a release tag Ghost creates, the tagger is the user who created the release. The tagger email is what a user's signing key must be linked to; otherwise anyone could sign a tag claiming someone else made it.

The reasons are the same strings as commits, except the mismatch reason names the object:

- `Signed and verified`
- `Signed by GitHub` / `Signed by Ghost` (platform key, no email check)
- `Signed with a key no Ghost account has uploaded`
- `The signing key is not linked to <email>`
- `Signature does not match the commit` for commits, `Signature does not match the tag` for tags

Each verdict also carries a machine-readable `state`, which GraphQL and the REST tag endpoint need:

| Verdict | `state` |
| --- | --- |
| verified (user key or platform key) | `valid` |
| no Ghost account uploaded the key | `unknown_key` |
| key known, owner has not verified the commit author / tagger email | `bad_email` |
| key known, signature does not match the object, or an SSH signature that cannot be parsed | `invalid` |

The verdict also carries the id of the user who owns the matching key (`signerId`), or null for a platform key or an unknown key. GraphQL needs it for `signer`.

A tag without a tagger line has no email to match. Modern `git mktag` refuses such a tag, so it only turns up in very old repositories. A user-key signature on it is not verified (`bad_email`, "not linked" against an empty address). A platform-key signature still verifies.

### Listing tags

`listTags` (`lib/git/tags/list-tags.ts`) also returns, for annotated tags, the tag object sha and the tagger email. Lightweight tags have neither.

### Ghost signing release tags

`createTagObject` (`lib/git/tags/create-tag.ts`) takes an optional `signer`, the same `CommitSigner` that `CommitSigningService.signer` gives merges. When one is passed, the tag text is signed and the armored signature is appended after the message, as `git tag -s` does. `ReleasesService` passes `CommitSigningService.signer` (undefined when no key is set).

### Ghost API

- `TagDTO` (`resources/repositories/dto/get-repository-tags.dto.ts`) gains `verification: CommitVerificationDTO | null`. It is null for lightweight and unsigned tags.
- `ReleaseDTO` gains `tagVerification: CommitVerificationDTO | null`, with the same rule, on every endpoint that returns a `ReleaseDTO`. It is null when the tag does not exist (a draft for a tag not yet created).

Reuse `CommitVerificationDTO` as-is. Do not add a tag-specific copy.

### GitHub REST: `GET /repos/{owner}/{repo}/git/tags/{tag_sha}`

The response matches GitHub's shape:

```json
{
  "node_id": "...",
  "tag": "v1.0.0",
  "sha": "<tag object sha>",
  "url": "<api>/repos/{owner}/{repo}/git/tags/<sha>",
  "message": "<message without the signature block>",
  "tagger": { "name": "...", "email": "...", "date": "<ISO 8601>" },
  "object": { "type": "commit", "sha": "<target sha>", "url": "<api>/repos/{owner}/{repo}/git/commits/<sha>" },
  "verification": {
    "verified": true,
    "reason": "valid",
    "signature": "<armored signature or null>",
    "payload": "<signed payload or null>",
    "verified_at": null
  }
}
```

- `reason` is the verdict's `state` (`valid`, `unknown_key`, `bad_email`, `invalid`), or `unsigned` when there is no signature. These are GitHub's REST reason strings. The coarser mapping for commits in `github/rest/pulls/pulls.service.ts` stays as it is; switching it to `state` is a follow-up.
- `signature` and `payload` are filled for a signed tag (GitHub fills them) and null for an unsigned one.
- `object.type` is the type git reports for the target. The `object.url` path segment follows it: `commits`, `trees`, `blobs` or `tags`.
- A sha that is missing or is not a tag object answers 404 `Not Found`, as GitHub does.
- Access follows `GET` on the existing git refs controller: a repository the viewer can read, and the `contents` app permission.

### GraphQL

Today Ghost serves `Ref` only as `defaultBranchRef` and the pull request refs, with `id`, `name`, `prefix` and `branchProtectionRule`. It has no `Tag` type and no `Commit.signature`. Add these, with types, nullability and argument names copied from `@octokit/graphql-schema`. `schema-conformance.spec.ts` must stay green.

**Entry points**

- `Repository.ref(qualifiedName: String!): Ref`. It accepts `refs/tags/v1`, `refs/heads/main`, and the short forms `v1` / `main` the way GitHub does: a branch name wins over a tag name. Null when the ref does not exist.
- `Repository.refs(refPrefix: String!, first, after, last, before, direction, orderBy, query): RefConnection`. `refPrefix` must be `refs/heads/` or `refs/tags/`; anything else returns null. `orderBy` supports `ALPHABETICAL` and `TAG_COMMIT_DATE`, and the default is alphabetical ascending, as on GitHub. `query` filters by a substring of the name. Use the `Connection` helper the other connections use.
- `Release.tag: Ref` (null when the tag does not exist) and `Release.tagCommit: Commit` (the commit the tag resolves to, or null).

**Types**

- `Ref.target: GitObject`. For a branch it is the `Commit`. For an annotated tag it is the `Tag`. For a lightweight tag it is the `Commit` it points at, as on GitHub.
- `Tag` implements `Node` and `GitObject`: `id`, `oid` (the tag object sha), `abbreviatedOid`, `name`, `message` (without the signature block), `tagger: GitActor` (null when there is no tagger line), `target: GitObject`, `repository`, `commitUrl` and `commitResourcePath` (pointing at the tagged commit, as GitHub does).
- `Commit` gains the `GitObject` interface fields it lacks (`commitUrl`, `commitResourcePath`, `repository`) and `signature: GitSignature`. `signature` is null for an unsigned commit.
- `GitSignature` is an interface with two implementations, `GpgSignature` (`keyId`) and `SshSignature` (`keyFingerprint`). It has the `GitSignatureState` enum. Ghost produces only `VALID`, `UNKNOWN_KEY`, `BAD_EMAIL` and `INVALID`, mapped one to one from `state`.

**`GitSignature` fields from Ghost's verdict**

- `isValid`: `state` is `valid`.
- `state`: as above.
- `email`: the commit author email.
- `signer`: the user with id `signerId`, or null.
- `wasSignedByGitHub`: true for a platform key, GitHub's or Ghost's. On Ghost, Ghost's own key plays the role GitHub's plays on github.com.
- `payload`, `signature`: the signed bytes and the armored signature.
- `verifiedAt`: null. Ghost verifies on read and keeps no date.
- `keyId` (GPG): the long key id. `keyFingerprint` (SSH): the `SHA256:` fingerprint.

Verify commits in one batch per request, not one `cat-file` per commit. A list of 100 refs must not spawn 100 git processes. The builder picks the mechanism (a request-scoped loader, or resolving signatures on the connection).

### Web

Show the existing `components/repositories/commit-verification.tsx` badge next to the tag name on:

- the tags page, `app/[username]/[repo]/(releases)/tags/page.tsx`
- the release page, `app/[username]/[repo]/(releases)/releases/tag/[...tag]/page.tsx`
- the releases list

No badge when `verification` / `tagVerification` is null.

## Tests (Claude writes them red, the builder makes them green)

- Splitting a tag object: PGP and SSH trailing blocks, a message that quotes the BEGIN line earlier, and an unsigned tag.
- `CommitVerificationService` on tag objects:
  - a GPG-signed tag by a key whose owner verified the tagger email: verified
  - an SSH-signed tag, same: verified
  - a tag signed with a key no account uploaded: not verified, unknown-key reason
  - a tag signed by a known key whose owner did not verify the tagger email: not verified, not-linked reason
- `listTags` returns the tag object sha and tagger email for annotated tags, and neither for lightweight ones.
- Releases: creating a release with `COMMIT_SIGNING_KEY` set writes a signed tag that verifies as `Signed by Ghost`. Without the key, the tag is unsigned and the release still succeeds.
- Ghost API: the tags list and a release carry `verification` / `tagVerification`. The value is null for a lightweight tag.
- Verdict `state` and `signerId` for each of the four outcomes, for commits and tags alike. The tag mismatch reason reads `Signature does not match the tag`.
- GraphQL e2e:
  - `repository.ref(qualifiedName: "refs/tags/<signed>") { target { ... on Tag { name oid message tagger { email } target { ... on Commit { oid signature { isValid state } } } } } }` returns GitHub's shape
  - `ref` with a short name prefers the branch over a tag of the same name
  - `refs(refPrefix: "refs/tags/", first: N)` pages, and returns a lightweight tag's `target` as a `Commit`
  - `release.tag` and `release.tagCommit` resolve
  - `Commit.signature` is a `GpgSignature` or an `SshSignature` with `state: VALID` and `signer { login }` for a verified commit, `UNKNOWN_KEY` for an unknown key, `BAD_EMAIL` for an unlinked email, and null for an unsigned commit
  - a Ghost-signed commit has `wasSignedByGitHub: true` and `signer: null`
- REST e2e: `GET git/tags/{sha}` returns GitHub's shape for a signed tag and `verification.reason: unsigned` for an unsigned one. It returns 404 for a commit sha and for a missing sha.

## Left to the builder

- How `readSignedCommits` and `verifyCommits` are named once they cover tags too. A rename is fine. A parallel `verifyTags` that copies the judging code is not.
- Where the REST handler lives: the existing `GithubGitController` (its prefix is `git/refs` today) or a sibling controller.
- `node_id` and GraphQL `id` encoding for `Tag`, following how other nodes build theirs. Whether `node(id:)` resolves a `Tag` is the builder's call. It is not required.
