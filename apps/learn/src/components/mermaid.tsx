"use client";

import { useEffect, useId, useState } from "react";

/** A Mermaid diagram, rendered in the browser and redrawn when the theme flips. */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? "dark" : "default",
        securityLevel: "strict",
      });
      const { svg } = await mermaid.render(`mermaid-${id}`, chart.trim());
      if (!cancelled) setSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [chart, dark, id]);

  return (
    <div
      className="not-prose my-6 flex justify-center overflow-x-auto"
      // Mermaid's own output, rendered with securityLevel strict.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
