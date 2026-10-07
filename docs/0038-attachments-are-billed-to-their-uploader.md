# 0038 — Attachments are billed to whoever uploads them, and swept once nothing mentions them

**Status:** adopted

## Decision

A file dropped, pasted or picked into any Markdown field is uploaded to `POST /api/repositories/:owner/:repo/attachments` and stored at `attachments/<repositoryId>/<id>`, with an `attachment` row. The editor inserts a link to `GET /api/attachments/:id`, as an image embed for images.

Anyone who can read the repository may attach, since anyone who can read it may comment. Anyone who can read the repository may download, so a private repository's attachments stay private. The URL carries the id alone, so it keeps working after the repository is renamed or transferred.

An attachment counts against its uploader's `asset` limit (0037), wherever it is posted. It never counts against the repository's account.

The type a file is served as comes from its extension, from a fixed list of images, videos, PDFs, text and archives. Anything else, SVG included, is refused. Images are served inline and everything else as a download, all with `nosniff` and a `sandbox` CSP. One file is at most 25 MB.

Nothing links an attachment to the text that shows it. Every hour, the API removes attachments over a day old whose id appears in no issue, pull request, comment, review or release text in their repository, along with uploads that never finished.

## Why

Billing the repository's account would let anyone who can comment on a public repository fill its owner's quota. Billing the uploader puts the cost on the person who chose to upload.

Tracking references would mean parsing every write of every Markdown field and keeping a link table in step with edits and deletions. Searching the text for the id finds the same answer from what is already stored. The day of grace covers a comment still being written.

## Consequences

- An attachment pasted into another repository's text is still swept, and still readable only by people who can read the repository it was uploaded to.
- An edit that removes an attachment frees the uploader's space a day later at the earliest.
- The sweep scans each candidate's repository text. Repositories with a very large amount of issue text may need an index on references later.
- An organization's `asset` usage never includes attachments, since only people upload them.
- Deleting a repository deletes its attachments, including those its users uploaded, and frees their space.
