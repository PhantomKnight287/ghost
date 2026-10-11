# gh capture

Every request real `gh` made in `test/gh-cli.e2e-spec.ts`, one file per test, recorded by `test/gh-capture.ts`. Logins, hosts, keys and node ids are replaced with placeholders, and secrets in bodies with `<redacted>`. `src/github/gh-capture.spec.ts` checks every GraphQL document here against `github.schema.gql` and every REST call against `openapi.json`, so a field or route `gh` needs and Ghost lacks fails CI.

## Refreshing

The `gh` suite runs on Linux only, so CI records the captures and uploads them as the `gh-capture` artifact on every run. After adding or changing a test in `gh-cli.e2e-spec.ts`, or when CI moves to a newer `gh`, replace this folder with the artifact from the latest run on your branch, keeping this README:

```sh
find apps/api/test/fixtures/gh-capture -name '*.json' -delete
gh run download <run-id> -n gh-capture -D apps/api/test/fixtures/gh-capture
```

On Linux the suite can record locally too: run it with `GH_CAPTURE_DIR` set to this folder.
