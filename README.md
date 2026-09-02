# ghost

Bun workspaces + Turborepo monorepo.

```
apps/
  web/   @ghost/web  – Next.js 16 (App Router, src/, Tailwind v4, shadcn/ui)  :3000
  api/   @ghost/api  – NestJS 12 (ESM)                                        :3001
packages/
  db/    @ghost/db   – Drizzle ORM + node-postgres, schema & migrations
```

## Setup

```bash
bun install
cp .env.example .env   # set DATABASE_URL
```

## Commands

| command | what |
| --- | --- |
| `bun run dev` | all apps in watch mode (turbo) |
| `bun run build` | build every package |
| `bun run check-types` | typecheck everything |
| `bun run db:generate` | generate SQL migrations from the schema |
| `bun run db:migrate` | apply migrations |
| `bun run db:push` | push schema straight to the DB |
| `bun run db:studio` | Drizzle Studio |

Add shadcn components: `bun run --filter @ghost/web -- bunx shadcn@latest add <name>`

## Database

Schema lives in `packages/db/src/schema/`, migrations in `packages/db/drizzle/`.
`@ghost/db` compiles to `dist/` (turbo builds it before the apps), and exports
`createDatabase()`, the `Database` type, the schema tables and common drizzle helpers.

The Nest app consumes it through `apps/api/src/database/database.module.ts` — a global
module providing the `DATABASE` token (injected in `UsersService` as a worked example),
closing the pool on shutdown.
