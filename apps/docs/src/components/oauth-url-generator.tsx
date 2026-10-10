"use client";

import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { type ReactNode, useEffect, useId, useState } from "react";

/** The scopes Ghost knows, as its API lists them; anything else is dropped. */
const SCOPES = [
  "repo",
  "public_repo",
  "read:org",
  "write:org",
  "admin:org",
  "user",
  "read:user",
  "user:email",
  "read:public_key",
  "write:public_key",
  "admin:public_key",
  "delete_repo",
  "gist",
];

function randomString(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return base64Url(values);
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function s256(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

/** Builds the authorize URL for an OAuth app, and the token request that redeems the code it leads to. Everything runs in the browser; nothing is sent anywhere. */
export function OauthUrlGenerator() {
  const [host, setHost] = useState("https://api.example.com");
  const [clientId, setClientId] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [scopes, setScopes] = useState<string[]>(["repo"]);
  const [state, setState] = useState("");
  const [pkce, setPkce] = useState(true);
  const [verifier, setVerifier] = useState("");
  const [challenge, setChallenge] = useState("");

  // Random values are made after mount, so the server render and the first client render agree.
  useEffect(() => {
    setState(randomString(16));
    setVerifier(randomString(48));
  }, []);

  useEffect(() => {
    if (verifier) s256(verifier).then(setChallenge);
  }, [verifier]);

  const base = host.trim().replace(/\/+$/, "") || "https://api.example.com";
  const params = new URLSearchParams({
    client_id: clientId.trim() || "YOUR_CLIENT_ID",
    ...(redirectUri.trim() && { redirect_uri: redirectUri.trim() }),
    ...(scopes.length > 0 && { scope: scopes.join(" ") }),
    ...(state && { state }),
    ...(pkce &&
      challenge && {
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
  });
  const authorizeUrl = `${base}/login/oauth/authorize?${params.toString().replace(/\+/g, "%20")}`;

  const curl = [
    `curl -X POST ${base}/login/oauth/access_token \\`,
    `  -H "Accept: application/json" \\`,
    `  -d client_id=${clientId.trim() || "YOUR_CLIENT_ID"} \\`,
    `  -d client_secret="$GHOST_CLIENT_SECRET" \\`,
    ...(redirectUri.trim()
      ? [`  -d redirect_uri=${redirectUri.trim()} \\`]
      : []),
    ...(pkce && verifier ? [`  -d code_verifier=${verifier} \\`] : []),
    "  -d code=CODE_FROM_THE_CALLBACK",
  ].join("\n");

  const toggle = (scope: string) =>
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((each) => each !== scope)
        : [...current, scope],
    );

  return (
    <div className="not-prose my-6 flex flex-col gap-5 rounded-xl border bg-fd-card p-5 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Ghost API host"
          hint="Where Ghost's API answers, with https://"
          value={host}
          onChange={setHost}
          placeholder="https://api.example.com"
        />
        <TextField
          label="Client ID"
          hint="From your app's page under Settings → OAuth apps"
          value={clientId}
          onChange={setClientId}
          placeholder="DEyiWXBFvHvUTGkCIQzDrbNEuetuxVOr"
          mono
        />
      </div>
      <TextField
        label="Redirect URI (optional)"
        hint="Leave empty to use the app's first callback URL"
        value={redirectUri}
        onChange={setRedirectUri}
        placeholder="https://bot.example/oauth/callback"
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Scopes</legend>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((scope) => {
            const on = scopes.includes(scope);
            return (
              <button
                key={scope}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(scope)}
                className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                  on
                    ? "border-fd-primary bg-fd-primary text-fd-primary-foreground"
                    : "bg-fd-background text-fd-muted-foreground hover:text-fd-foreground"
                }`}
              >
                {scope}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-fd-muted-foreground">
          {scopes.length === 0
            ? "No scope: the app may read public information only."
            : "Ask for the fewest your app needs."}
        </p>
      </fieldset>

      <TextField
        label="State"
        hint="Random per request. Check it comes back unchanged."
        value={state}
        onChange={setState}
        mono
        action={
          <RegenerateButton onClick={() => setState(randomString(16))}>
            New state
          </RegenerateButton>
        }
      />

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={pkce}
          onChange={(event) => setPkce(event.target.checked)}
          className="mt-0.5 size-4 accent-fd-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Use PKCE</span>
          <span className="text-xs text-fd-muted-foreground">
            Adds a code challenge to the URL. Keep the verifier below with the
            request: the token exchange needs it.
          </span>
        </span>
      </label>
      {pkce && (
        <TextField
          label="Code verifier"
          hint="Secret. Store it server-side until the callback arrives."
          value={verifier}
          onChange={setVerifier}
          mono
          action={
            <RegenerateButton onClick={() => setVerifier(randomString(48))}>
              New verifier
            </RegenerateButton>
          }
        />
      )}

      <Output
        title="1. Send the person to this URL"
        action={
          <a
            href={authorizeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-fd-primary underline-offset-4 hover:underline"
          >
            Open in a new tab
          </a>
        }
      >
        <DynamicCodeBlock
          lang="txt"
          code={authorizeUrl}
          codeblock={{
            className:
              "[&_*]:whitespace-pre-wrap [&_*]:break-all [&_pre]:w-full!",
          }}
        />
      </Output>
      <Output title="2. Exchange the code from the callback, on your server">
        <DynamicCodeBlock lang="bash" code={curl} />
      </Output>
    </div>
  );
}

function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  action,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  /** A button beside the input, such as one that makes a new random value. */
  action?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className={`h-9 min-w-0 flex-1 rounded-md border bg-fd-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-fd-ring ${mono ? "font-mono text-xs" : ""}`}
        />
        {action}
      </div>
      <span className="text-xs text-fd-muted-foreground">{hint}</span>
    </div>
  );
}

function RegenerateButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 shrink-0 rounded-md border bg-fd-background px-3 text-xs hover:bg-fd-accent"
    >
      {children}
    </button>
  );
}

function Output({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
