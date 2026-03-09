# Jira Integration (Frontend)

This folder hosts the Jira OAuth callback route and documents the Jira flow used by the UI. The main dashboard lives at `/` and uses GraphQL to connect Jira and create issues.

## Routes
- `/`: Dashboard UI (login, connect Jira, create issue)
- `/jira/callback`: OAuth callback handler
- `/jira-walkthrough`: Optional walkthrough page

## Required config
Set in `apps/web/.env.local` (see `.env.example`):
- `NEXT_PUBLIC_GRAPHQL_URL` (e.g. `http://localhost:4000/graphql`)

## Required Jira OAuth scopes
These are requested by the backend and must be enabled in the Atlassian app:
- `read:jira-work`
- `write:jira-work`
- `manage:jira-webhook`

## Jira user permissions
The connected Jira user must have project permissions to:
- Browse Projects
- Create Issues
- Assign Issues (only if assigning during creation)

If the project uses required custom fields, the user must also have permission to set those fields.

## Connection flow
1. User signs up or logs in on `/` and receives a JWT.
2. The JWT is stored in `localStorage` under the key `token`.
3. The user clicks Connect Jira, which calls `beginJiraConnection` and redirects to Atlassian.
4. Atlassian redirects to `/jira/callback` with `code` and `state`.
5. The callback page calls `completeJiraConnection` using the stored JWT.

## Creating an issue
The dashboard calls `createJiraIssue` with:
- `projectKey`, `summary`, `description`, `issueType`
- optional `labels`, `priority`, `assigneeAccountId`

Project keys must be the Jira key (e.g. `TEST`), not the project name.

## Common issues
- Missing token, code, or state on `/jira/callback` will block the connection.
- "Jira is not connected" means the user must reconnect Jira.
- Invalid project key errors indicate the key is not the Jira project key.
