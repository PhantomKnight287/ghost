import { describe, expect, it, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// bun's module mocks are process-wide, so keep every other export the real one.
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ push() {}, replace() {} }),
  usePathname: () => "/auth/sign-up",
  useSearchParams: () => new URLSearchParams(),
}));

const { Providers } = await import("@/components/providers");
const { Auth } = await import("./auth");

describe("Auth", () => {
  it("renders sign-up, whose username field needs the plugin's renderer", () => {
    const html = renderToStaticMarkup(
      createElement(Providers, null, createElement(Auth, { path: "sign-up" })),
    );
    expect(html).toContain('name="additionalFields.username"');
  });
});
