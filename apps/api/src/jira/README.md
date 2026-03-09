# Jira Integration (API)

This module handles Atlassian Jira OAuth (3LO), stores the connection per user, and provides GraphQL operations to create issues and read Jira metadata. All Jira operations are protected by JWT auth.

## What it does
1. Generates an Atlassian OAuth authorization URL for the current user.
2. Exchanges the OAuth code for access and refresh tokens.
3. Stores the Jira cloud ID, site name, and tokens in the database.
4. Creates Jira issues and stores a local ticket record.
5. Lists Jira projects and assignable users.

## Environment variables
These must be set in `apps/api/.env` (see `.env.example`):
- `JIRA_CLIENT_ID`
- `JIRA_CLIENT_SECRET`
- `JIRA_CALLBACK_URL` (must match the Atlassian app callback URL)
- `JWT_SECRET`
- `DATABASE_URL`
- `APP_URL`

The API runs on port `4000` and exposes GraphQL at `/graphql`.

## Required Jira OAuth scopes
The Atlassian app must request these scopes (configured in the Atlassian developer console):
- `read:jira-work`
- `write:jira-work`
- `manage:jira-webhook`

## GraphQL operations
All Jira queries and mutations require `Authorization: Bearer <jwt>`.

Queries:
- `jiraConnection`: returns `{ connected, siteName }`.
- `jiraProjects`: returns the user's accessible Jira projects.
- `jiraAssignableUsers(projectKey)`: returns assignable users for a project.
- `myTickets`: returns locally stored tickets created through this app.

Mutations:
- `beginJiraConnection`: returns `{ authorizationUrl, state }`.
- `completeJiraConnection(input: { code, state })`: finalizes OAuth and stores tokens.
- `createJiraIssue(input: CreateJiraIssueInput)`: creates a Jira issue and stores a `Ticket`.

### CreateJiraIssueInput fields
- `projectKey` (required): Jira project key, uppercase, e.g. `TEST`.
- `summary` (required)
- `description` (required)
- `issueType` (required), e.g. `Task`
- `labels` (optional, array)
- `priority` (optional)
- `assigneeAccountId` (optional)

If the project key is invalid, the API returns a clear error telling you to use the project key, not the name.

## Data model
Relevant Prisma models:
- `JiraConnection`: stores `cloudId`, `siteName`, access and refresh tokens, and expiry.
- `Ticket`: stores `jiraIssueId`, `jiraKey`, `summary`, and `projectKey`.

## Token refresh behavior
If the Jira access token is within 60 seconds of expiry, the service uses the refresh token to obtain a new access token. If no refresh token is available, the user must reconnect Jira.

## Typical OAuth flow
1. User logs in to the app and calls `beginJiraConnection`.
2. User is redirected to the Atlassian consent screen.
3. Atlassian redirects to `JIRA_CALLBACK_URL` with `code` and `state`.
4. Frontend calls `completeJiraConnection` to persist the connection.
5. User can now create issues and read Jira data.
