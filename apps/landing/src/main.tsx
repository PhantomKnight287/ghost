import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const WEB_APP_URL =
  import.meta.env.NEXT_PUBLIC_WEB_APP_URL ?? "http://localhost:3000";
const API_URL = import.meta.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const DOCS_URL =
  import.meta.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3003";
const LEARN_URL =
  import.meta.env.NEXT_PUBLIC_LEARN_URL ?? "http://localhost:3005";
const REPOSITORY_URL =
  import.meta.env.NEXT_PUBLIC_REPOSITORY_URL ?? `${WEB_APP_URL}/ghost/ghost`;

const REMOTE_COMMAND = `git remote add ghost ${API_URL}/you/project.git`;

const PULL_REQUESTS = [
  {
    title: "feat(issues): delete issues",
    number: 136,
    checks: "4/4",
    reviewers: ["JT", "AK"],
    state: "Merged",
  },
  {
    title: "Review requests and CODEOWNERS",
    number: 86,
    checks: "4/4",
    reviewers: ["JT"],
    state: "Merged",
  },
  {
    title: "Rate limit the API per token",
    number: 121,
    checks: "3/4",
    reviewers: ["AK", "MR"],
    state: "Open",
  },
  {
    title: "Show signed tags as verified",
    number: 129,
    checks: "4/4",
    reviewers: ["MR"],
    state: "Open",
  },
  {
    title: "Ghost Apps and the Checks API",
    number: 132,
    checks: "4/4",
    reviewers: ["JT", "MR"],
    state: "Merged",
  },
];

const CHECKS = [
  { name: "build", time: "1m 12s", passed: true },
  { name: "test / api", time: "4m 03s", passed: true },
  { name: "test / web", time: "52s", passed: true },
  { name: "CODEOWNERS review", time: "waiting", passed: false },
];

const DELIVERIES = [
  { event: "push", target: "ci.internal/hooks/ghost", code: 200, ms: 84 },
  {
    event: "pull_request",
    target: "hooks.slack.com/services/…",
    code: 200,
    ms: 141,
  },
  { event: "issues", target: "discord.com/api/webhooks/…", code: 204, ms: 97 },
  { event: "check_run", target: "deploy.internal/ghost", code: 503, ms: 2004 },
  { event: "release", target: "ci.internal/hooks/ghost", code: 200, ms: 63 },
];

const STEPS = [
  {
    title: "Add a remote",
    body: "Point any existing repository at Ghost. Every branch and tag comes with it.",
    lines: [
      "$ git remote add ghost https://api.ghost.example/acme/api.git",
      "$ git push ghost --all",
      "To api.ghost.example/acme/api.git",
      " * [new branch]  main -> main",
    ],
  },
  {
    title: "Open a pull request",
    body: "Push a branch, open the pull request from the web or with the GitHub CLI.",
    lines: [
      "$ export GH_HOST=api.ghost.example",
      "$ gh pr create --fill",
      "Creating pull request for feat/search into main",
      "https://ghost.example/acme/api/pull/42",
    ],
  },
  {
    title: "Review and merge",
    body: "Review the split diff in the web, then merge, squash or rebase from the page or the terminal.",
    lines: [
      "$ gh pr checks 42",
      "✓ build  1m12s",
      "$ gh pr merge 42 --squash",
      "✓ Squashed and merged pull request acme/api#42",
    ],
  },
  {
    title: "Wire up the rest",
    body: "Webhooks, apps and checks report back to the pull request they belong to.",
    lines: [
      "POST /repos/acme/api/check-runs",
      '{ "name": "build", "head_sha": "4f2c1e9" }',
      "201 Created",
      "→ shown on acme/api#42",
    ],
  },
];

const EVERYTHING = [
  "Push over HTTP or SSH",
  "Git LFS",
  "Submodules",
  "Code search, indexed on push",
  "Highlighting for 300+ languages",
  "Branches, tags and releases",
  "GPG-signed commits and tags",
  "Issues, labels and assignees",
  "Milestones",
  "#123 cross references",
  "Review requests",
  "CODEOWNERS",
  "Branch rulesets",
  "Organizations and teams",
  "Five permission roles",
  "Webhooks",
  "Ghost Apps",
  "OAuth apps",
  "Checks API",
  "GitHub CLI support",
  "Import from GitHub",
  "Forks and stars",
  "Notifications",
  "Light, dark and custom themes",
];

const QUESTIONS = [
  {
    question: "Is Ghost a fork of another git host?",
    answer:
      "No. Ghost is its own app: a NestJS API, a Next.js web app and Postgres, with git served over HTTP and SSH.",
  },
  {
    question: "Where does my code live?",
    answer:
      "In an S3-compatible bucket. Every push is written there before it is acknowledged. The server's disk is only a cache and rebuilds itself from the bucket.",
  },
  {
    question: "Can I keep using the GitHub CLI?",
    answer:
      "Yes. Set GH_HOST to your Ghost API host and gh repo, gh issue, gh pr and gh api work against Ghost.",
  },
  {
    question: "What does self-hosting need?",
    answer:
      "Docker. One setup script asks for a domain, an SMTP server and a data directory, and generates every secret you skip.",
  },
  {
    question: "What is not built yet?",
    answer:
      "CI runners. Checks from your own CI already report back to pull requests through the Checks API.",
  },
];

function GhostMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
    </svg>
  );
}

function RemoteCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="command">
      <code>{REMOTE_COMMAND}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(REMOTE_COMMAND);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function SectionHead({
  tag,
  title,
  body,
}: {
  tag: string;
  title: string;
  body: string;
}) {
  return (
    <div className="section-head">
      <span className="tag">{tag}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function App() {
  const [step, setStep] = useState(0);

  return (
    <>
      <header>
        <a className="brand" href="/">
          <GhostMark />
          Ghost
        </a>
        <nav>
          <a href={DOCS_URL}>Docs</a>
          <a href={LEARN_URL}>Learn</a>
          <a href={REPOSITORY_URL}>Source</a>
        </nav>
        <a className="button primary" href={WEB_APP_URL}>
          Open Ghost ›
        </a>
      </header>

      <main>
        <section className="hero">
          <h1>
            Git hosting that runs <span className="chip">on our cloud</span> or{" "}
            <span className="chip accent">on your server</span>.
          </h1>
          <p>
            Repositories, pull requests, code review, issues, search, teams,
            webhooks and apps. One platform, hosted by us or by you.
          </p>
          <RemoteCommand />
          <div className="actions">
            <a className="button primary" href={WEB_APP_URL}>
              Open Ghost ›
            </a>
            <a className="button" href={`${DOCS_URL}/self-hosting`}>
              Self-host it
            </a>
          </div>
        </section>

        <section className="strip">
          <div>
            <strong>Object storage first</strong>
            <span>Every push lands in S3 before it is acknowledged.</span>
          </div>
          <div>
            <strong>Speaks the GitHub CLI</strong>
            <span>Set GH_HOST and keep using gh.</span>
          </div>
          <div>
            <strong>Self-host in one script</strong>
            <span>Docker, a domain and an SMTP server.</span>
          </div>
        </section>

        <section className="block">
          <SectionHead
            tag="Review"
            title="Review code where it lives."
            body="Pull requests across branches and forks, reviews pinned to the commit they read, and checks that gate the merge."
          />
          <div className="panels">
            <div className="panel">
              <div className="panel-row panel-header pr-row">
                <span>Pull request</span>
                <span>Checks</span>
                <span>Reviewers</span>
                <span>State</span>
              </div>
              {PULL_REQUESTS.map((pr) => (
                <div key={pr.number} className="panel-row pr-row">
                  <span className="truncate">
                    <span className="muted">#{pr.number}</span> {pr.title}
                  </span>
                  <span className={pr.checks === "4/4" ? "good" : "warn"}>
                    ● {pr.checks}
                  </span>
                  <span className="avatars">
                    {pr.reviewers.map((reviewer) => (
                      <span key={reviewer}>{reviewer}</span>
                    ))}
                  </span>
                  <span className={`state ${pr.state.toLowerCase()}`}>
                    {pr.state}
                  </span>
                </div>
              ))}
            </div>
            <div className="panel">
              <div className="panel-row panel-header">Checks on #121</div>
              {CHECKS.map((check) => (
                <div key={check.name} className="panel-row check-row">
                  <span className={check.passed ? "good" : "warn"}>
                    {check.passed ? "✓" : "○"}
                  </span>
                  <span>{check.name}</span>
                  <span className="muted">{check.time}</span>
                </div>
              ))}
              <div className="panel-foot">Merge blocked: 1 required review</div>
            </div>
          </div>
        </section>

        <section className="block">
          <SectionHead
            tag="Automate"
            title="Tell the rest of your stack."
            body="Webhooks with retries and a delivery log, formatted for Slack, Discord, Google Chat and Teams when that is where they go."
          />
          <div className="panel">
            <div className="panel-row panel-header delivery-row">
              <span>Event</span>
              <span>Target</span>
              <span>Status</span>
              <span>Time</span>
            </div>
            {DELIVERIES.map((delivery) => (
              <div
                key={`${delivery.event}-${delivery.target}`}
                className="panel-row delivery-row"
              >
                <span className="pill">{delivery.event}</span>
                <span className="truncate mono">{delivery.target}</span>
                <span className={delivery.code < 300 ? "good" : "bad"}>
                  {delivery.code}
                </span>
                <span className="muted">{delivery.ms} ms</span>
              </div>
            ))}
          </div>
          <p className="connect">
            Talks to <span className="pill">Slack</span>
            <span className="pill">Discord</span>
            <span className="pill">Google Chat</span>
            <span className="pill">Teams</span>
            <span className="pill">Any URL</span>
          </p>
        </section>
      </main>

      <section className="dark">
        <div className="dark-inner">
          <SectionHead
            tag="How it works"
            title="Change the remote. Keep the workflow."
            body="Same git, same pull requests, same gh commands. Bring a repository over with one push."
          />
          <div className="steps">
            <ol>
              {STEPS.map((item, index) => (
                <li key={item.title}>
                  <button
                    type="button"
                    aria-expanded={step === index}
                    onClick={() => setStep(index)}
                  >
                    <span className="index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {item.title}
                  </button>
                  {step === index && <p>{item.body}</p>}
                </li>
              ))}
            </ol>
            <pre className="terminal">{STEPS[step].lines.join("\n")}</pre>
          </div>
        </div>
      </section>

      <main>
        <section className="block">
          <SectionHead
            tag="Everything else"
            title="Plus what you reach for every day."
            body="All of it in Ghost Cloud, all of it when you self-host."
          />
          <ul className="everything">
            {EVERYTHING.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="block">
          <SectionHead
            tag="FAQ"
            title="Frequently asked questions"
            body="More in the docs, and how it works inside in Learn."
          />
          <div className="faq">
            {QUESTIONS.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="hero closing">
          <h2>Your code, on a host you choose.</h2>
          <div className="actions">
            <a className="button primary" href={WEB_APP_URL}>
              Open Ghost ›
            </a>
            <a className="button" href={DOCS_URL}>
              Read the docs
            </a>
          </div>
        </section>
      </main>

      <footer>
        <span className="brand">
          <GhostMark />
          Ghost
        </span>
        <nav>
          <a href={WEB_APP_URL}>Ghost Cloud</a>
          <a href={DOCS_URL}>Docs</a>
          <a href={LEARN_URL}>Learn</a>
          <a href={REPOSITORY_URL}>Source</a>
        </nav>
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
