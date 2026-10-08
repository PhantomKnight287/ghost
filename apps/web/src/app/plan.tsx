import { Check, Ghost } from "lucide-react";
import type { ReactNode } from "react";

export function Plan({
  label,
  tag,
  title,
  body,
  points,
  featured = false,
  children,
}: {
  label: string;
  tag: string;
  title: string;
  body: string;
  points: string[];
  featured?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative flex min-w-0 flex-1 flex-col gap-7 overflow-hidden rounded-[22px] px-6 py-7 md:gap-10 md:p-10 ${
        featured
          ? "bg-primary text-primary-foreground"
          : "border border-background/15 bg-background/5"
      }`}
    >
      {featured && (
        <Ghost
          aria-hidden
          strokeWidth={0.5}
          className="absolute -right-8 -bottom-10 hidden size-60 -rotate-10 fill-primary-foreground/10 text-primary-foreground/20 md:block"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-mono text-xs tracking-[0.08em] uppercase ${featured ? "opacity-85" : "text-background/60"}`}
        >
          {label}
        </span>
        <span
          className={`rounded-full px-3 py-1 text-[13px] font-medium ${
            featured
              ? "bg-primary-foreground text-primary"
              : "border border-background/20 text-background/70"
          }`}
        >
          {tag}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.035em] md:text-[40px]">
          {title}
        </h3>
        <p className="leading-relaxed opacity-80 md:text-[17px]">{body}</p>
      </div>
      <ul className="flex flex-col gap-3.5">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-3">
            <Check
              aria-hidden
              strokeWidth={2.4}
              className={`size-4.5 shrink-0 ${featured ? "" : "text-background/60"}`}
            />
            {point}
          </li>
        ))}
      </ul>
      <div className="relative">{children}</div>
    </div>
  );
}
