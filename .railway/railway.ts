import {
  bucket,
  defineRailway,
  github,
  image,
  postgres,
  preserve,
  project,
  redis,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const ghost = github("PhantomKnight287/ghost", { checkSuites: false });

  const Postgres = postgres("Postgres", { region: "asia-southeast1-eqsg3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const Redis = redis("Redis", { region: "asia-southeast1-eqsg3a" });
  Redis.deploy = {
    startCommand:
      '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
  };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const postgresDatabase = postgres("postgres", {
    region: "asia-southeast1-eqsg3a",
  });
  postgresDatabase.networking = { privateNetworkEndpoint: "postgres-30b4" };
  const apiVolume = volume("api-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  });
  const postgresVolumeUO8m = volume("postgres-volume-uO8m", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  });
  const postgresVolume = volume("postgres-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  });
  const redisVolume = volume("redis-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  });
  const ghostBucket = bucket("ghost-bucket", { region: "sin" });
  const syncApi = service("sync-api", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/sync/api/Dockerfile",
      watchPatterns: ["/apps/sync/api/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    domains: [{ domain: "sync-api.ghost.procrastinator.fyi", port: 3006 }],
    env: {
      GHOST_API_URL: preserve(),
      GHOST_APP_CLIENT_ID: preserve(),
      GHOST_APP_CLIENT_SECRET: preserve(),
      GHOST_APP_ID: preserve(),
      GHOST_APP_PRIVATE_KEY: preserve(),
      GHOST_APP_SLUG: preserve(),
      GHOST_APP_WEBHOOK_SECRET: preserve(),
      GHOST_WEB_URL: preserve(),
      GITHUB_APP_CLIENT_ID: preserve(),
      GITHUB_APP_CLIENT_SECRET: preserve(),
      GITHUB_APP_ID: preserve(),
      GITHUB_APP_PRIVATE_KEY: preserve(),
      GITHUB_APP_SLUG: preserve(),
      GITHUB_APP_WEBHOOK_SECRET: preserve(),
      SYNC_API_URL: preserve(),
      SYNC_AUTH_SECRET: preserve(),
      SYNC_DATABASE_URL: preserve(),
      SYNC_DATA_DIR: preserve(),
      SYNC_WEB_URL: preserve(),
    },
  });
  const syncWeb = service("sync-web", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/sync/web/Dockerfile",
      watchPatterns: ["/apps/sync/web/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { sleepApplication: true },
    domains: ["sync.ghost.procrastinator.fyi"],
    env: { VITE_SYNC_API_URL: preserve() },
  });
  const importer = service("importer", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/importer/Dockerfile",
      watchPatterns: ["/apps/importer/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { sleepApplication: true },
    env: { GHOST_API_URL: preserve(), IMPORTER_SECRET: preserve() },
  });
  const learn = service("learn", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/learn/Dockerfile",
      watchPatterns: ["/apps/learn/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: { sleepApplication: true },
    domains: ["learn.ghost.procrastinator.fyi"],
    networking: { privateNetworkEndpoint: "ghost" },
    env: {
      NEXT_PUBLIC_LEARN_URL: preserve(),
      NEXT_PUBLIC_REPOSITORY_URL: preserve(),
    },
  });
  const web = service("web", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/web/Dockerfile",
      watchPatterns: ["/apps/web/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    deploy: {
      limitOverride: { containers: { memoryBytes: 500000000 } },
      restartPolicyType: "ALWAYS",
      sleepApplication: true,
    },
    domains: ["web.ghost.procrastinator.fyi"],
    env: {
      INTERNAL_API_URL: preserve(),
      NEXT_PUBLIC_API_URL: preserve(),
      NEXT_PUBLIC_DATABUDDY_CLIENT_ID: preserve(),
      NEXT_PUBLIC_DOCS_URL: preserve(),
      NEXT_PUBLIC_GITHUB_CLIENT_ID: preserve(),
      NEXT_PUBLIC_SITE_URL: preserve(),
      NEXT_PUBLIC_SSH_CLONE_HOST: preserve(),
      NODE_OPTIONS: preserve(),
      WEB_API_SECRET: preserve(),
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
    networking: { tcpProxies: { "3110": {} } },
    volumeMounts: { "/tmp": apiVolume },
    env: {
      ASSET_STORAGE_QUOTA_BYTES: preserve(),
      AUTH_COOKIE_DOMAIN: preserve(),
      AUTH_TRUSTED_ORIGINS: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      COMMIT_SIGNING_KEY: preserve(),
      DATABASE_URL: preserve(),
      EMAIL_PROXY: preserve(),
      EMAIL_PROXY_SECRET: preserve(),
      EMAIL_SENDER: preserve(),
      EMAIL_VERIFICATION_ENABLED: preserve(),
      FORK_STORAGE_QUOTA_BYTES: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      GIT_SSH_HOST_KEY: preserve(),
      GIT_SSH_PORT: preserve(),
      IMPORTER_SECRET: preserve(),
      IMPORTER_URL: preserve(),
      LFS_STORAGE_QUOTA_BYTES: preserve(),
      NODE_OPTIONS: preserve(),
      PORT: preserve(),
      RATE_LIMIT_WEB_ANONYMOUS_PER_MINUTE: preserve(),
      RATE_LIMIT_WEB_PER_MINUTE: preserve(),
      REDIS_URL: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
      STORAGE_QUOTA_BYTES: preserve(),
      WEBHOOK_ALLOW_PRIVATE_NETWORKS: preserve(),
      WEBHOOK_SECRET_KEY: preserve(),
      WEB_API_SECRET: preserve(),
      WEB_APP_URL: preserve(),
      ZOEKT_URL: preserve(),
      ZOEKT_URL_BASE: preserve(),
    },
  });
  const delivery = service("delivery", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/delivery/Dockerfile",
      watchPatterns: ["/apps/delivery/**"],
    },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: {
      DATABASE_URL: preserve(),
      EMAIL_PROXY: preserve(),
      EMAIL_PROXY_SECRET: preserve(),
      WEBHOOK_ALLOW_PRIVATE_NETWORKS: preserve(),
      WEBHOOK_SECRET_KEY: preserve(),
    },
  });
  const zoekt = service("zoekt", {
    source: ghost,
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/apps/zoekt/Dockerfile",
      watchPatterns: ["/apps/zoekt/**"],
    },
    healthcheck: "/healthz",
    replicas: { "asia-southeast1-eqsg3a": 1 },
    env: {
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_SECRET_ACCESS_KEY: preserve(),
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
      syncApi,
      syncWeb,
      importer,
      learn,
      web,
      Postgres,
      docs,
      Redis,
      api,
      postgresDatabase,
      delivery,
      zoekt,
      otelLgtm,
      apiVolume,
      postgresVolumeUO8m,
      postgresVolume,
      redisVolume,
      ghostBucket,
    ],
  });
});
