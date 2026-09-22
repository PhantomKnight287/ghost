import {
  bucket,
  defineRailway,
  github,
  image,
  postgres,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const ghost = github("PhantomKnight287/ghost", { checkSuites: false });

  const postgresDatabase = postgres("postgres", {
    region: "asia-southeast1-eqsg3a",
  });
  postgresDatabase.networking = { privateNetworkEndpoint: "postgres-30b4" };
  const postgresVolumeUO8m = volume("postgres-volume-uO8m", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  });
  const ghostBucket = bucket("ghost-bucket", { region: "sin" });
  const web = service("web", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/web/Dockerfile",
      watchPatterns: ["/apps/web/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { sleepApplication: true },
    domains: ["web.ghost.procrastinator.fyi"],
    env: {
      NEXT_PUBLIC_API_URL: preserve(),
      NEXT_PUBLIC_DOCS_URL: preserve(),
      NEXT_PUBLIC_SITE_URL: preserve(),
      NEXT_PUBLIC_SSH_CLONE_HOST: preserve(),
      OTEL_EXPORTER_OTLP_ENDPOINT: preserve(),
    },
  });
  const docs = service("docs", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/docs/Dockerfile",
      watchPatterns: ["/apps/docs/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { sleepApplication: true },
    domains: ["docs.ghost.procrastinator.fyi"],
    env: {
      NEXT_PUBLIC_DOCS_URL: preserve(),
      NEXT_PUBLIC_WEB_APP_URL: preserve(),
    },
  });
  const api = service("api", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "apps/api/Dockerfile",
      watchPatterns: ["/apps/api/**"],
    },
    healthcheck: "/api",
    healthcheckTimeout: 60,
    preDeploy: "node packages/db/dist/migrate.js",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { restartPolicyMaxRetries: 5, sleepApplication: true },
    domains: ["api.ghost.procrastinator.fyi"],
    env: {
      AUTH_COOKIE_DOMAIN: preserve(),
      AUTH_TRUSTED_ORIGINS: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      DATABASE_URL: preserve(),
      EMAIL_PROXY: preserve(),
      EMAIL_PROXY_SECRET: preserve(),
      EMAIL_SENDER: preserve(),
      EMAIL_VERIFICATION_ENABLED: preserve(),
      GIT_SSH_HOST_KEY: preserve(),
      GIT_SSH_PORT: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      WEB_APP_URL: preserve(),
    },
  });
  const otelLgtm = service("otel-lgtm", {
    source: image("grafana/otel-lgtm"),
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { sleepApplication: true },
    env: {
      GF_SECURITY_ADMIN_PASSWORD: preserve(),
      GF_SECURITY_ADMIN_USER: preserve(),
    },
  });

  return project("Ghost", {
    resources: [
      web,
      docs,
      api,
      postgresDatabase,
      otelLgtm,
      postgresVolumeUO8m,
      ghostBucket,
    ],
  });
});
