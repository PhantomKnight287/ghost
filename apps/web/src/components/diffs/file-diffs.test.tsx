import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FileDiffs } from "./file-diffs";

const before = "a".repeat(40);
const after = "b".repeat(40);

const render = (submodule: { from: string | null; to: string | null }) =>
  renderToStaticMarkup(
    <FileDiffs
      patchUrl="https://api.ghost.test/patch"
      files={[{ status: "M", path: "vendor/lib", submodule }]}
    />,
  );

describe("FileDiffs", () => {
  test("states a moved submodule as the commits on each side", () => {
    expect(render({ from: before, to: after })).toContain(
      "Subproject commit aaaaaaa…bbbbbbb",
    );
  });

  test("states an added submodule by its new commit", () => {
    expect(render({ from: null, to: after })).toContain(
      "Subproject commit bbbbbbb added",
    );
  });

  test("states a removed submodule by its old commit", () => {
    expect(render({ from: before, to: null })).toContain(
      "Subproject commit aaaaaaa removed",
    );
  });
});
