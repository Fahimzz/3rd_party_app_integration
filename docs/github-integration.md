# GitHub Integration Flow

This document explains the GitHub integration implemented in this repository: prerequisites, environment variables, authentication flow, repository discovery, issue creation, current limitations, and troubleshooting.

## 1. What this integration does

The GitHub integration allows a signed-in local user to:

- connect a GitHub account
- load repositories that are available to that connection
- create GitHub issues from the dashboard

This project currently supports two GitHub connection modes:

- `app`: GitHub App user authorization flow
- `oauth`: GitHub OAuth App flow

For this codebase, `app` mode is the recommended path when you want the integration to follow GitHub App installation rules.

## 2. Prerequisites

### Local project prerequisites

- Node.js 20+
- `pnpm`
- PostgreSQL
- API running on `http://localhost:4000/graphql`
- Web app running on `http://localhost:3000`

### GitHub App prerequisites

If you are using `GITHUB_AUTH_MODE="app"`:

- Create a GitHub App in GitHub Developer Settings.
- Set the callback URL to `http://localhost:3000/github/callback`.
- Use the GitHub App `Client ID` and `Client Secret` in `apps/api/.env`.
- Install the GitHub App on the target personal account or organization.
- Give the installation access to the repository you want to use.
- Grant repository permission `Issues: Read and write`.
- The GitHub user who connects through the web flow must be able to access that installation.

Important:

- In GitHub App mode, this project only shows repositories from installations the connected user can access.
- Repositories are only shown when the installation has issue write access.

### OAuth App prerequisites

If you are using `GITHUB_AUTH_MODE="oauth"`:

- Create a GitHub OAuth App in GitHub Developer Settings.
- Set the authorization callback URL to `http://localhost:3000/github/callback`.
- Use the OAuth App `Client ID` and `Client Secret` in `apps/api/.env`.
- The connected user must grant repository access when redirecting through GitHub.

## 3. Environment variables

API env lives in `apps/api/.env`.

Required GitHub-related variables:

```env
GITHUB_AUTH_MODE="app"
GITHUB_CLIENT_ID="replace-me"
GITHUB_CLIENT_SECRET="replace-me"
GITHUB_CALLBACK_URL="http://localhost:3000/github/callback"
```

Meaning:

- `GITHUB_AUTH_MODE`
  - `app`: use GitHub App user authorization flow
  - `oauth`: use GitHub OAuth App flow
- `GITHUB_CLIENT_ID`
  - the client ID for the selected GitHub app type
- `GITHUB_CLIENT_SECRET`
  - the client secret for the selected GitHub app type
- `GITHUB_CALLBACK_URL`
  - must match the GitHub callback URL configured in GitHub

Other required API env values still apply:

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_URL`

Web env:

- `NEXT_PUBLIC_GRAPHQL_URL`

## 4. High-level flow

The end-to-end GitHub flow in this project is:

1. The user signs up or logs in to the local app.
2. The frontend stores the local JWT in `localStorage`.
3. The user clicks `Connect GitHub`.
4. The frontend calls `beginGithubConnection`.
5. The backend returns a GitHub authorization URL and a signed `state`.
6. The browser is redirected to GitHub.
7. GitHub redirects back to `http://localhost:3000/github/callback?code=...&state=...`.
8. The callback page calls `completeGithubConnection`.
9. The backend exchanges the GitHub `code` for an access token.
10. The backend stores the GitHub connection in the database.
11. The dashboard loads `githubConnection` and `githubRepos`.
12. The user selects a repository and creates an issue with `createGithubIssue`.

## 5. GraphQL flow

All protected GitHub operations require:

- `Authorization: Bearer <local-jwt>`

Base local GraphQL endpoint:

- `http://localhost:4000/graphql`

## 5.1 Start GitHub connection

```graphql
mutation BeginGithubConnection {
  beginGithubConnection {
    authorizationUrl
    state
  }
}
```

What happens:

- The backend builds a `state` value containing:
  - the local `userId`
  - a random nonce
- The backend returns a GitHub authorization URL.
- In `oauth` mode, the backend requests repository access.
- In `app` mode, the backend starts GitHub App user authorization flow.

## 5.2 Complete GitHub callback

GitHub redirects back to:

- `http://localhost:3000/github/callback?code=...&state=...`

The frontend callback page sends:

```graphql
mutation CompleteGithubConnection($input: CompleteGithubConnectionInput!) {
  completeGithubConnection(input: $input) {
    connected
    login
  }
}
```

Variables:

```json
{
  "input": {
    "code": "<code-from-github>",
    "state": "<state-from-callback>"
  }
}
```

What the backend does:

- decodes and validates `state`
- exchanges `code` for a GitHub access token
- detects whether the token is a GitHub App user token or an OAuth token
- fetches the GitHub login
- stores the connection in the `GithubConnection` table

## 5.3 Load dashboard GitHub data

```graphql
query Dashboard {
  githubConnection {
    connected
    login
  }
  githubRepos {
    id
    name
    fullName
    ownerLogin
    htmlUrl
    private
  }
}
```

## 5.4 Create GitHub issue

```graphql
mutation CreateGithubIssue($input: CreateGithubIssueInput!) {
  createGithubIssue(input: $input) {
    id
    number
    url
    title
  }
}
```

Example variables:

```json
{
  "input": {
    "repoFullName": "owner/repo",
    "title": "Bug from dashboard",
    "body": "Created from the local integration app",
    "labels": ["bug", "integration"],
    "assignees": ["octocat"]
  }
}
```

## 6. Repository discovery rules

Repository loading behaves differently by auth mode.

### `app` mode

When the stored GitHub token is a GitHub App user token:

- the backend calls `GET /user/installations`
- it keeps only installations where `permissions.issues === "write"`
- for each matching installation it calls:
  - `GET /user/installations/{installation_id}/repositories`
- it merges those repositories and returns them to the UI

Effect:

- the UI only shows repositories where the GitHub App installation is available to the connected user
- the app does not show unrelated repositories from the user's full GitHub account

If the UI says `No GitHub repos found`, that means no installation-scoped repositories with issue write access were returned.

### `oauth` mode

When the stored token is an OAuth token:

- the backend calls `GET /user/repos?per_page=100&sort=updated`

Effect:

- the UI shows repositories available to the OAuth user token

## 7. Issue creation flow

When a user submits the GitHub issue form:

1. The frontend collects:
   - `repoFullName`
   - `title`
   - optional `body`
   - optional `labels`
   - optional `assignees`
2. The frontend calls `createGithubIssue`.
3. In `app` mode, the backend first checks that the selected repo still exists in the accessible installation-scoped repository list.
4. The backend sends:
   - `POST /repos/{owner}/{repo}/issues`
5. The backend returns:
   - GitHub issue ID
   - issue number
   - issue URL
   - title

## 8. Database model

GitHub connections are stored in the `GithubConnection` table.

Current stored fields:

- `userId`
- `accessToken`
- `tokenType`
- `scope`
- `login`
- timestamps

This is enough for the current flow, but note the limitation below about token refresh.

## 9. Current implementation files

Main files involved in the GitHub flow:

- `apps/api/src/github/github.service.ts`
- `apps/api/src/github/github.resolver.ts`
- `apps/api/src/github/github.module.ts`
- `apps/api/prisma/schema.prisma`
- `apps/web/app/page.tsx`
- `apps/web/app/github/callback/page.tsx`

## 10. Current limitations

These are important to know before debugging:

- GitHub App mode currently uses a stored user access token for API calls.
- The backend does not yet create installation access tokens.
- GitHub App user access token refresh is not implemented yet.
- Repository discovery in GitHub App mode only includes installations with `Issues: write`.
- If a repository is not part of the installation, it will not appear in the UI.

## 11. Troubleshooting

### `GitHub OAuth token is missing repository access`

Cause:

- You are using OAuth mode and the returned token does not have repository access.
- Or you intended to use a GitHub App but configured OAuth mode.

Fix:

1. If you are using a GitHub App, set `GITHUB_AUTH_MODE="app"` and reconnect.
2. If you are using OAuth, reconnect and grant repository access.

### `Resource not accessible by integration`

Cause:

- The GitHub App is not installed on the selected repository.
- The app does not have `Issues: Read and write`.
- The connected GitHub user cannot access that installation.
- The repo is outside the app installation.

Fix:

1. Install the GitHub App on the repository or organization.
2. Grant `Issues: Read and write`.
3. Reconnect GitHub after changing permissions or installation scope.

### `No GitHub repos found`

Cause in `app` mode:

- The GitHub App is not installed anywhere the connected user can access.
- The installation does not include the target repository.
- The installation does not have issue write permission.

Cause in `oauth` mode:

- The OAuth token has access to no repositories matching the current account context.

Fix:

1. Confirm the correct auth mode is set in `apps/api/.env`.
2. Confirm the GitHub app credentials are for the same app type.
3. Confirm the callback URL is correct.
4. Confirm the GitHub App installation includes the target repository.
5. Reconnect GitHub.

### Callback URL mismatch or redirect failure

Cause:

- The callback URL in GitHub does not match `GITHUB_CALLBACK_URL`.

Fix:

1. Set both to `http://localhost:3000/github/callback` for local development.

## 12. Setup checklist

Use this checklist when setting up from scratch:

- Copy `apps/api/.env.example` to `apps/api/.env`.
- Set `DATABASE_URL`, `JWT_SECRET`, and `APP_URL`.
- Choose `GITHUB_AUTH_MODE`:
  - `app` for GitHub App flow
  - `oauth` for OAuth App flow
- Add the matching `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
- Set `GITHUB_CALLBACK_URL=http://localhost:3000/github/callback`.
- Start the API and web app.
- Sign up or log in locally.
- Click `Connect GitHub`.
- Complete the GitHub authorization redirect.
- Verify that repositories appear in the dashboard.
- Create a test GitHub issue.

## 13. Recommended setup for this repo

If your goal is to use a GitHub App, use this configuration:

```env
GITHUB_AUTH_MODE="app"
GITHUB_CALLBACK_URL="http://localhost:3000/github/callback"
```

Then make sure:

- the GitHub App credentials in `apps/api/.env` belong to the GitHub App, not an OAuth App
- the app is installed on the repository you want to use
- `Issues: Read and write` is enabled
- you reconnect GitHub after any GitHub-side permission or installation change
