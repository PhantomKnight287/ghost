import { ImageResponse } from "next/og";
import { createElement } from "react";

import { type IconName, icons } from "./og-icons";
import { languageColor } from "@ghost/languages";

/** Shared by every card route. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori resolves no CSS variables, so the palette is spelled out.
const INK = "#0b0b0c";
const FOREGROUND = "#f4f4f5";
const MUTED = "#8b8b93";
const HAIRLINE = "#26262b";
const ACCENT = "#a78bfa";

export type OgStat = { icon: IconName; label: string };
export type OgLanguage = { language: string; percent: number };
export type OgBadge = { label: string; color?: string };

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
  /** Sits before the eyebrow. */
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
        flexDirection: "column",
        justifyContent: "space-between",
        background: INK,
        color: FOREGROUND,
        padding: 72,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {icon ? <Icon name={icon} size={30} color={MUTED} /> : null}
          <div style={{ display: "flex", fontSize: 30, color: MUTED }}>
            {truncate(eyebrow, 58)}
          </div>
        </div>

        {badge ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 24,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: badge.color ?? MUTED,
            }}
          >
            <div
              style={{
                display: "flex",
                width: 12,
                height: 12,
                borderRadius: 12,
                background: badge.color ?? MUTED,
              }}
            />
            {badge.label}
          </div>
        ) : null}
      </div>

      {usable(avatar) ? (
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <img
            src={avatar}
            width={200}
            height={200}
            alt=""
            style={{ borderRadius: 200, border: `1px solid ${HAIRLINE}` }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                fontSize: titleSize(title, 60),
                fontWeight: 600,
                letterSpacing: -1,
                lineHeight: 1.15,
                wordBreak: "break-word",
              }}
            >
              {truncate(title, 60)}
            </div>
            {description ? (
              <div style={{ display: "flex", fontSize: 34, color: MUTED }}>
                {truncate(description, 52)}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {description ? (
            <div style={{ display: "flex", fontSize: 28, color: MUTED }}>
              {truncate(description, 96)}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: titleSize(title),
              fontWeight: 600,
              letterSpacing: -1,
              lineHeight: 1.15,
              // long identifiers and file names have no spaces to break on
              wordBreak: "break-word",
            }}
          >
            {truncate(title, 110)}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {languages?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "flex",
                height: 10,
                borderRadius: 10,
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

            {/* a card is read at a glance: the long tail would not be legible */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 28,
                fontSize: 22,
                color: MUTED,
              }}
            >
              {languages.slice(0, 4).map(({ language, percent }) => (
                <div
                  key={language}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: 12,
                      height: 12,
                      borderRadius: 12,
                      background: languageColor(language),
                    }}
                  />
                  {language} {percent.toFixed(1)}%
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", height: 1, background: HAIRLINE }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: MUTED,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            {stats?.map((stat) => (
              <div
                key={stat.label}
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <Icon name={stat.icon} size={24} color={MUTED} />
                {stat.label}
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: FOREGROUND,
            }}
          >
            <Icon name="ghost" size={26} color={ACCENT} />
            Ghost
          </div>
        </div>
      </div>
    </div>,
    size,
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

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** "1 label", "2 labels", "2 entries". */
export function plural(value: number, one: string, many = `${one}s`) {
  return `${value} ${value === 1 ? one : many}`;
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
