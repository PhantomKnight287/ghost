import { beforeEach, describe, expect, test } from "bun:test";
import { withMarker } from "../src/format.ts";
import type { Repo } from "./fake-host.ts";
import { BOTS, databaseUrl, startWorld, twoRepositories, type World } from "./harness.ts";

describe.skipIf(!databaseUrl)("issues, comments and labels through webhooks", () => {
  let world: World;
  let ghostRepo: Repo;
  let githubRepo: Repo;
  beforeEach(async () => {
    world = await startWorld(import.meta.file);
    ({ ghostRepo, githubRepo } = twoRepositories(world));
    world.ghost.push("acme/app", "main", "first");
    await world.settle();
    await world.pair();
  });

  const only = (repo: Repo, title: string) => {
    const matches = [...repo.items.values()].filter((item) => item.title === title);
    expect(matches).toHaveLength(1);
    return matches[0] as NonNullable<(typeof matches)[0]>;
  };

  test("an issue opened on GitHub appears once on Ghost, and the copy's own webhook is not copied back", async () => {
    await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "Bug", body: "It broke" });
    await world.settle();
    expect(only(ghostRepo, "Bug")).toMatchObject({ author: BOTS.ghost, body: withMarker("It broke", "github", "dave") });
    only(githubRepo, "Bug");
  });

  test("an edit made to the copy on Ghost goes back to the GitHub original without a marker", async () => {
    await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "Bug", body: "It broke" });
    await world.settle();
    const copy = only(ghostRepo, "Bug");
    await world.ghost.as("bob").request("PATCH", `/repos/acme/app/issues/${copy.number}`, { title: "Bug on save", body: withMarker("It broke when saving", "github", "dave") });
    await world.settle();
    expect(only(githubRepo, "Bug on save")).toMatchObject({ author: "dave", body: "It broke when saving" });
  });

  test("closing and reopening follow both ways", async () => {
    await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "Task", body: "Do it" });
    await world.settle();
    const copy = only(githubRepo, "Task");
    await world.github.as("dave").request("PATCH", `/repos/acme-gh/app/issues/${copy.number}`, { state: "closed" });
    await world.settle();
    expect(only(ghostRepo, "Task").state).toBe("closed");
    await world.ghost.as("alice").request("PATCH", `/repos/acme/app/issues/${only(ghostRepo, "Task").number}`, { state: "open" });
    await world.settle();
    expect(only(githubRepo, "Task").state).toBe("open");
  });

  test("a comment is copied, its edit follows, and its deletion removes the copy", async () => {
    await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "Talk", body: "" });
    await world.settle();
    const ghostIssue = only(ghostRepo, "Talk");
    const githubIssue = only(githubRepo, "Talk");

    const posted = await world.ghost.as("carol").request<{ id: number }>("POST", `/repos/acme/app/issues/${ghostIssue.number}/comments`, { body: "First thought" });
    await world.settle();
    const copies = () => githubRepo.comments.filter((comment) => comment.number === githubIssue.number);
    expect(copies().map((comment) => comment.body)).toEqual([withMarker("First thought", "ghost", "carol")]);

    await world.ghost.as("carol").request("PATCH", `/repos/acme/app/issues/comments/${posted.id}`, { body: "Second thought" });
    await world.settle();
    expect(copies().map((comment) => comment.body)).toEqual([withMarker("Second thought", "ghost", "carol")]);

    await world.ghost.as("carol").request("DELETE", `/repos/acme/app/issues/comments/${posted.id}`);
    await world.settle();
    expect(copies()).toEqual([]);
    expect(ghostRepo.comments.filter((comment) => comment.number === ghostIssue.number)).toEqual([]);
  });

  test("a comment on GitHub lands on Ghost under the right issue", async () => {
    await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "Talk", body: "" });
    await world.settle();
    await world.github.as("coderabbitai[bot]").request("POST", `/repos/acme-gh/app/issues/${only(githubRepo, "Talk").number}/comments`, { body: "Summary: looks fine" });
    await world.settle();
    expect(ghostRepo.comments.filter((comment) => comment.number === only(ghostRepo, "Talk").number).map((comment) => comment.body)).toEqual([withMarker("Summary: looks fine", "github", "coderabbitai[bot]")]);
  });

  test("labels: created on one side, put on an issue, and renamed on GitHub without a duplicate", async () => {
    await world.github.as("dave").request("POST", "/repos/acme-gh/app/labels", { name: "bug", color: "d73a4a", description: "Broken" });
    await world.settle();
    expect(ghostRepo.labels.get("bug")).toEqual({ name: "bug", color: "d73a4a", description: "Broken" });

    await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "Labelled", body: "", labels: ["bug"] });
    await world.settle();
    expect(only(githubRepo, "Labelled").labels).toEqual(["bug"]);

    await world.github.as("dave").request("PATCH", "/repos/acme-gh/app/labels/bug", { new_name: "defect" });
    await world.settle();
    expect([...ghostRepo.labels.keys()]).toEqual(["defect"]);
    expect(only(ghostRepo, "Labelled").labels).toEqual(["defect"]);
  });

  test("a label deleted on Ghost is deleted on GitHub", async () => {
    await world.ghost.as("alice").request("POST", "/repos/acme/app/labels", { name: "wontfix", color: "ffffff", description: null });
    await world.settle();
    expect(githubRepo.labels.has("wontfix")).toBe(true);
    await world.ghost.as("alice").request("DELETE", "/repos/acme/app/labels/wontfix");
    await world.settle();
    expect(githubRepo.labels.has("wontfix")).toBe(false);
  });

  test("an issue deleted on Ghost is deleted on GitHub", async () => {
    await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "Spam", body: "" });
    await world.settle();
    const nodeId = (await world.ghost.as("bob").request<{ node_id: string }>("GET", `/repos/acme/app/issues/${only(ghostRepo, "Spam").number}`)).node_id;
    await world.ghost.as("bob").graphql("mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }", { id: nodeId });
    await world.settle();
    expect([...githubRepo.items.values()].filter((item) => item.title === "Spam")).toEqual([]);
  });

  test("when GitHub refuses the delete, the copy is closed with a note instead", async () => {
    world.github.settings.refuseDeleteIssue = true;
    await world.ghost.as("alice").request("POST", "/repos/acme/app/issues", { title: "Spam", body: "" });
    await world.settle();
    const copy = only(githubRepo, "Spam");
    const nodeId = (await world.ghost.as("bob").request<{ node_id: string }>("GET", `/repos/acme/app/issues/${only(ghostRepo, "Spam").number}`)).node_id;
    await world.ghost.as("bob").graphql("mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }", { id: nodeId });
    await world.settle();
    expect(copy.state).toBe("closed");
    expect(githubRepo.comments.filter((comment) => comment.number === copy.number).map((comment) => comment.body)).toEqual(["Deleted on Ghost"]);
  });

  test("a webhook delivered twice is acted on once", async () => {
    await world.github.as("dave").request("POST", "/repos/acme-gh/app/issues", { title: "Once", body: "" });
    const [delivery] = world.github.takeDeliveries();
    if (!delivery) throw new Error("no delivery");
    const copy = delivery.clone();
    expect((await world.server.app.fetch(delivery)).status).toBe(202);
    expect((await world.server.app.fetch(copy)).status).toBe(200);
    await world.settle();
    only(ghostRepo, "Once");
  });

  test("a webhook with a wrong signature is refused and changes nothing", async () => {
    const forged = new Request("http://sync.test/webhooks/github", {
      method: "POST",
      body: JSON.stringify({ action: "opened", repository: { id: githubRepo.id }, sender: { login: "mallory" }, issue: { number: 1 } }),
      headers: { "x-github-event": "issues", "x-github-delivery": "forged", "x-hub-signature-256": `sha256=${"0".repeat(64)}` },
    });
    expect((await world.server.app.fetch(forged)).status).toBe(401);
  });
});
