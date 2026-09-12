import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
  bucket,
} from "railway/iac";

const REPO = "PhantomKnight287/ghost";

// Sessions are cookies on the API's domain, so both services have to sit under
// one registrable domain. `*.up.railway.app` is a public suffix and cannot hold
// a shared cookie, which is why these are custom domains. Edit them to yours.
//
// Railway does not register custom domains from configuration: add both in the
// dashboard, then `railway config pull`. These constants only build the URLs
// the two services need to know about each other.
const ROOT_DOMAIN = "example.com";
const WEB_DOMAIN = `ghost.${ROOT_DOMAIN}`;
const API_DOMAIN = `api.ghost.${ROOT_DOMAIN}`;

const API_URL = `https://${API_DOMAIN}`;
const WEB_URL = `https://${WEB_DOMAIN}`;

export default defineRailway(() => {
  const db = postgres("postgres");
  const storage = bucket("ghost-bucket", { region: "sin" });
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
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      DATABASE_URL: db.env.DATABASE_URL,
      BETTER_AUTH_URL: API_URL,
      AUTH_TRUSTED_ORIGINS: WEB_URL,
      AUTH_COOKIE_DOMAIN: `.${ROOT_DOMAIN}`,
      BETTER_AUTH_SECRET: preserve(),
      // we set `preserve` here cus storage.env does not exist. We need to set it manually on dashboard
      S3_BUCKET: preserve(),
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

  return project("ghost", { resources: [db, api, web,storage] });
});
