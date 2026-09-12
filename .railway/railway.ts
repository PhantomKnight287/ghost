import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
} from "railway/iac";

const REPO = "PhantomKnight287/ghost";

// Sessions are cookies on the API's domain, so both services have to sit under
// one registrable domain. `*.up.railway.app` is a public suffix and cannot hold
// a shared cookie, which is why these are custom domains. Edit them to yours.
const ROOT_DOMAIN = "example.com";
const WEB_DOMAIN = `ghost.${ROOT_DOMAIN}`;
const API_DOMAIN = `api.ghost.${ROOT_DOMAIN}`;

const API_URL = `https://${API_DOMAIN}`;
const WEB_URL = `https://${WEB_DOMAIN}`;

export default defineRailway(() => {
  const db = postgres("postgres");

  const api = service("api", {
    source: github(REPO),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/api/Dockerfile",
    },
    // Applies packages/db/drizzle/*.sql; a failure keeps the old version up.
    preDeploy: "node packages/db/dist/migrate.js",
    healthcheck: "/api",
    healthcheckTimeout: 60,
    domains: [API_DOMAIN],
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      BETTER_AUTH_URL: API_URL,
      AUTH_TRUSTED_ORIGINS: WEB_URL,
      AUTH_COOKIE_DOMAIN: `.${ROOT_DOMAIN}`,
      S3_BUCKET: "ghost",
      // Secrets stay out of the repository: set them once in the dashboard or
      // with `railway variables`, and `preserve()` keeps what is already there.
      BETTER_AUTH_SECRET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
    },
  });

  const web = service("web", {
    source: github(REPO),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "apps/web/Dockerfile",
    },
    healthcheck: "/",
    healthcheckTimeout: 60,
    domains: [WEB_DOMAIN],
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      // Inlined into the browser bundle at build time: the Dockerfile picks it
      // up through `ARG NEXT_PUBLIC_API_URL`, so a change needs a rebuild.
      NEXT_PUBLIC_API_URL: API_URL,
    },
  });

  return project("ghost", { resources: [db, api, web] });
});
