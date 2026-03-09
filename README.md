# 3rd Party App Integration

This repo contains a Jira integration MVP with a NestJS GraphQL API and a Next.js frontend.

## Structure
- `apps/api`: NestJS GraphQL API (Jira OAuth + issue creation)
- `apps/web`: Next.js UI (login, connect Jira, create issue)

## Prerequisites
- Node.js 20+ (recommended)
- pnpm
- PostgreSQL database
- Atlassian Developer app with Jira OAuth (3LO) enabled

## Environment setup
API env (`apps/api/.env`):
- `DATABASE_URL`
- `JWT_SECRET`
- `APP_URL`
- `JIRA_CLIENT_ID`
- `JIRA_CLIENT_SECRET`
- `JIRA_CALLBACK_URL`

You can copy `apps/api/.env.example` and fill in real values.

Web env (`apps/web/.env.local`):
- `NEXT_PUBLIC_GRAPHQL_URL` (e.g. `http://localhost:4000/graphql`)

You can copy `apps/web/.env.example` and adjust if needed.

## Install dependencies
From the repo root:
1. `pnpm install`

## Database
From `apps/api`:
1. `pnpm prisma migrate dev`
2. `pnpm prisma generate`

## Run in development
In two terminals:
1. API: `cd apps/api` then `pnpm start:dev`
2. Web: `cd apps/web` then `pnpm dev`

The UI runs at `http://localhost:3000` and the GraphQL API at `http://localhost:4000/graphql`.

## Build and run production
From the repo root:
1. `pnpm -C apps/api build`
2. `pnpm -C apps/web build`

Then:
1. API: `cd apps/api` then `node dist/main.js`
2. Web: `cd apps/web` then `pnpm start`

## Jira OAuth requirements
The Atlassian app must include these scopes:
- `read:jira-work`
- `write:jira-work`
- `manage:jira-webhook`

The connected Jira user needs project permissions to browse projects and create issues.
