import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

const docs = defineDocs({
  dir: "content/docs",
});

/** The docs are the whole site, so pages hang off the root rather than /docs. */
export const source = loader(docs.toFumadocsSource(), { baseUrl: "/" });
