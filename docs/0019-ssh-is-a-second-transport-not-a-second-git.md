# 0019 — SSH is a second transport, not a second git

**Status:** adopted

## Decision

SSH carries the same two git services HTTP carries, over the same services, to
the same commit point. The listener is a transport adapter: it authenticates a
connection, authorizes a repository through `RepositoryAccessService`, and hands
streams to `PackProcessService` and `GitService`.

Three rules make it a transport rather than a second implementation:

1. **One access decision.** `decideAccess` answers for both transports. SSH
   adds no permission logic of its own.
2. **One commit point.** A push over SSH is spooled, committed to the log with
   `PushTransactionService.commitPush`, then replayed into
   `git receive-pack --stateless-rpc` — the order [0005](0005-single-commit-point.md)
   requires.
3. **No shell, ever.** A session runs `git-upload-pack` or `git-receive-pack`
   and nothing else.

## Authentication is a key, and only a key

SSH authenticates the *connection*, before any repository or command is known.
OpenSSH probes with the `none` method first and only offers a key once the
server rejects it, so a server that accepts `none` never sees the client's key.

That leaves one workable shape: **publickey or nothing**. A connection carries a
key that belongs to an account, or it does not connect.

Anonymous clone therefore lives on HTTP, where `decideAccess` already serves a
public repository to `actor: null`, the response is cacheable, and the pre-push
probe ([0014](0014-the-pre-push-probe.md)) has somewhere to happen.

**Rejected:** a magic `anonymous@` login, and a second listener with a
read-only policy. Both reintroduce an unauthenticated path for something HTTP
already does better. The second listener stays the answer if anonymous SSH is
ever actually needed — the policy belongs to the endpoint, never to a username.

## Why fetch and push are shaped differently

`upload-pack` runs as a plain duplex: the channel is piped into git, git's
output is piped back, and nothing is buffered. It is the faster path and the
simpler one.

`receive-pack` cannot be, because the log has to accept a push *before* git
sees it, and the ref commands can only be read from the front of a body that
must still be replayed in full. So a push is spooled to a temp file
([0015](0015-nothing-holds-a-packfile.md)), committed, then fed to
`--stateless-rpc`, exactly as the HTTP transport does. The server writes the
advertisement itself, from `--advertise-refs`, so the capabilities the client
answers are the ones `--stateless-rpc` will read back.

This is safe because `git send-pack` closes its side of the channel after
writing the packfile and before reading the report — verified against a real
client, not assumed.

## Two details that cost a debugging session each

- **A pipe must not close the channel.** `child.stdout.pipe(channel)` ends the
  channel when git exits, and the `exit-status` message then arrives on a
  closed channel. The client sees no exit status and calls a perfectly good
  fetch `remote transport reported error`. Both pipes use `end: false`, and the
  channel is closed after `exit()`.
- **The connection must outlive the channel.** Ending the connection when the
  command finishes truncates whatever is still queued behind the SSH
  flow-control window — invisible on a small repository, fatal on a large one.
  The connection closes when the channel closes.

## Consequences

- A host key is configuration (`GIT_SSH_HOST_KEY`). Without it the listener
  never starts, which doubles as the feature flag. It is never generated at
  boot: a new host key on every restart is a changed-host-key warning for every
  user.
- The SSH login name is ignored. The key names the account, so every URL uses
  `git@`.
- A push over SSH materializes the repository twice — once to advertise, once
  inside `receivePack`. The second is an index read against storage, and
  keeping one commit path is worth it.
