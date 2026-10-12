import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Mermaid } from "./mermaid";
import { Question, Quiz } from "./quiz";
import { Adr, Source } from "./source";
import { TryIt } from "./try-it";

/** Components lessons may use without importing them. */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Adr,
    Callout,
    Card,
    Cards,
    Mermaid,
    Question,
    Quiz,
    Source,
    Step,
    Steps,
    Tab,
    Tabs,
    TryIt,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
