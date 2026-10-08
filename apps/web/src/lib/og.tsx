import { ImageResponse } from "next/og";
import { type ReactNode, createElement } from "react";

import { type IconName, icons } from "./og-icons";
import { languageColor } from "@ghost/languages";

/** Shared by every card route. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori resolves no CSS variables, so the dark lavender theme in globals.css is spelled out.
const ACCENT = "#221f2d";
const CARD = "#131215";
const FOREGROUND = "#f2f1f4";
const MUTED = "#9e9da6";
const HAIRLINE = "rgba(255, 255, 255, 0.1)";
const PRIMARY = "#c2b1f8";

export type OgStat = { icon: IconName; label: string };
export type OgLanguage = { language: string; percent: number };
export type OgBadge = { label: string; color?: string };

/** The landing page's hero: a card rising out of a lavender panel. */
export function ogCard({
  eyebrow,
  icon,
  avatar,
  badge,
  title,
  description,
  stats,
  languages,
}: {
  eyebrow: string;
  /** Sits before the eyebrow, in place of its dot. */
  icon?: IconName;
  /** Drawn large beside the title, with the description under it. */
  avatar?: string | null;
  badge?: OgBadge;
  title: string;
  description?: string | null;
  stats?: OgStat[];
  /** Drawn as a bar above the footer, in the order the API returns. */
  languages?: OgLanguage[];
}) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: ACCENT,
        padding: "56px 56px 0",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 60px 56px",
          background: CARD,
          color: FOREGROUND,
          border: `1px solid ${HAIRLINE}`,
          borderBottom: "none",
          borderRadius: "24px 24px 0 0",
          boxShadow: "0 30px 60px -30px rgba(0, 0, 0, 0.6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 22,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: PRIMARY,
            }}
          >
            {icon ? (
              <Icon name={icon} size={24} color={PRIMARY} />
            ) : (
              <Dot color={PRIMARY} />
            )}
            {truncate(eyebrow, 56)}
          </div>
          {badge ? <Badge badge={badge} /> : null}
        </div>

        {usable(avatar) ? (
          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            <img
              src={avatar}
              width={170}
              height={170}
              alt=""
              style={{ borderRadius: 170, border: `1px solid ${HAIRLINE}` }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Title text={title} max={60} />
              {description ? (
                <div style={{ display: "flex", fontSize: 32, color: MUTED }}>
                  {truncate(plain(description), 48)}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Title text={title} />
            {description ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 28,
                  lineHeight: 1.4,
                  color: MUTED,
                }}
              >
                {truncate(plain(description), 100)}
              </div>
            ) : null}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {languages?.length ? (
            <div
              style={{
                display: "flex",
                height: 8,
                borderRadius: 8,
                overflow: "hidden",
                background: HAIRLINE,
              }}
            >
              {languages.map(({ language, percent }) => (
                <div
                  key={language}
                  style={{
                    display: "flex",
                    width: `${percent}%`,
                    background: languageColor(language),
                  }}
                />
              ))}
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 10,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              {stats?.map((stat) => (
                <Chip key={stat.label}>
                  <Icon name={stat.icon} size={20} color={MUTED} />
                  {truncate(stat.label, 32)}
                </Chip>
              ))}
              {/* a card is read at a glance: the long tail would not be legible */}
              {languages?.slice(0, 2).map(({ language, percent }) => (
                <Chip key={language}>
                  <Dot color={languageColor(language)} />
                  {language} {percent.toFixed(0)}%
                </Chip>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 28,
                fontWeight: 600,
                letterSpacing: -0.5,
                flexShrink: 0,
              }}
            >
              <Icon name="ghost" size={28} color={FOREGROUND} />
              Ghost
            </div>
          </div>
        </div>
      </div>
    </div>,
    size,
  );
}

function Badge({ badge }: { badge: OgBadge }) {
  const color = badge.color ?? MUTED;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 18px",
        borderRadius: 999,
        border: `1px solid ${HAIRLINE}`,
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        color,
      }}
    >
      <Dot color={color} />
      {truncate(badge.label, 32)}
    </div>
  );
}

function Title({ text, max }: { text: string; max?: number }) {
  return (
    <div
      style={{
        display: "flex",
        fontSize: titleSize(text, max),
        fontWeight: 600,
        letterSpacing: "-0.045em",
        lineHeight: 1.05,
        // long identifiers and file names have no spaces to break on
        wordBreak: "break-word",
      }}
    >
      {truncate(text, max ?? 110)}
    </div>
  );
}

/** The rounded-full chips from the landing page's feature list. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 18px",
        borderRadius: 999,
        border: `1px solid ${HAIRLINE}`,
        fontSize: 22,
        color: MUTED,
      }}
    >
      {children}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <div
      style={{
        display: "flex",
        width: 12,
        height: 12,
        borderRadius: 12,
        background: color,
      }}
    />
  );
}

/** Keeps a long title on three lines or fewer. `max` caps it when the avatar takes half the row. */
function titleSize(title: string, max = 82) {
  const size =
    title.length <= 22
      ? 82
      : title.length <= 34
        ? 62
        : title.length <= 52
          ? 46
          : 38;

  return Math.min(size, max);
}

/** Issue and release bodies are markdown; a card shows the words, not the syntax. */
export function plain(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** "1 label", "2 labels", "2 entries". */
export function plural(value: number, one: string, many = `${one}s`) {
  return `${value} ${value === 1 ? one : many}`;
}

/** Files, lines and (for a search across repositories) repositories a code search matched. */
export function codeSearchStats(
  files: { lines: unknown[]; repository?: { owner: string; slug: string } }[],
): OgStat[] {
  const repositories = new Set(
    files.flatMap(({ repository }) =>
      repository ? [`${repository.owner}/${repository.slug}`] : [],
    ),
  );

  return [
    { icon: "fileCode", label: plural(files.length, "file") },
    {
      icon: "code",
      label: plural(
        files.reduce((sum, file) => sum + file.lines.length, 0),
        "matching line",
      ),
    },
    ...(repositories.size > 0
      ? [
          {
            icon: "bookMarked" as const,
            label: plural(repositories.size, "repository", "repositories"),
          },
        ]
      : []),
  ];
}

/** Keeps both ends of a path readable when the middle has to go. */
export function shortenPath(path: string, max = 72) {
  if (path.length <= max) return path;

  const segments = path.split("/");
  const tail = segments.at(-1) ?? path;
  const head = segments[0] ?? "";

  return `${head}/…/${tail}`.length <= max
    ? `${head}/…/${tail}`
    : `…/${truncate(tail, max - 2)}`;
}

/** Satori decodes png, jpeg, gif and svg only; a webp data URI (what the auth provider stores) crashes it, so anything else falls back to the icon. */
function usable(avatar?: string | null): avatar is string {
  if (!avatar) return false;
  return avatar.startsWith("http")
    ? true
    : /^data:image\/(png|jpe?g|gif|svg\+xml);/.test(avatar);
}

/** Satori renders plain SVG, so icons are drawn from their raw geometry. */
function Icon({
  name,
  size,
  color = "currentColor",
}: {
  name: IconName;
  size: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name].map(([tag, attrs], index) =>
        createElement(tag, { key: index, ...attrs }),
      )}
    </svg>
  );
}
