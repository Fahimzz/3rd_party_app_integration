# Jira Integration Full Flow

## Purpose

This document explains the full Jira integration implemented in this project, from user authentication to Jira OAuth, project lookup, assignee lookup, issue creation, token refresh, and local persistence. It is written as a Notion-ready technical walkthrough.

## High-level summary

The Jira integration is split across two apps:

- `apps/web`: Next.js frontend
- `apps/api`: NestJS GraphQL backend

The backend owns the Jira OAuth exchange, token storage, Jira API calls, and database writes.
The frontend owns the user experience: login, connect Jira, callback handling, selecting Jira projects, and submitting issue data.

## User outcome

A user can:

1. Create an account or log in to the app.
2. Connect their own Jira account using Atlassian OAuth.
3. View whether Jira is connected.
4. Load accessible Jira projects.
5. Load assignable users for a selected project.
6. Create a Jira issue from the frontend form.
7. See locally stored ticket records after issue creation.

## Architecture

### Frontend responsibilities

- Collect user credentials for app login.
- Store the app JWT in `localStorage`.
- Call GraphQL queries and mutations with the JWT.
- Redirect the user to Atlassian for consent.
- Handle the Jira callback route.
- Render Jira projects, assignable users, and stored tickets.
- Submit issue creation data.

### Backend responsibilities

- Protect Jira GraphQL operations with JWT auth.
- Generate the Jira OAuth authorization URL.
- Validate OAuth state.
- Exchange the authorization code for Jira tokens.
- Resolve the target Jira site from Atlassian accessible resources.
- Persist the Jira connection for the logged-in user.
- Refresh expired Jira tokens.
- Call Jira REST APIs for projects, assignable users, and issue creation.
- Store a local `Ticket` record after a Jira issue is created.

## Prerequisites

### Atlassian app requirements

The Atlassian OAuth app must be configured with:

- Client ID
- Client secret
- Callback URL matching the frontend callback route

Required Jira OAuth scopes:

- `read:jira-work`
- `write:jira-work`
- `manage:jira-webhook`

### Environment variables

API environment in `apps/api/.env`:

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_URL`
- `JIRA_CLIENT_ID`
- `JIRA_CLIENT_SECRET`
- `JIRA_CALLBACK_URL`

Web environment in `apps/web/.env.local`:

- `NEXT_PUBLIC_GRAPHQL_URL`

### Jira user permissions

The connected Jira user should have permission to:

- Browse projects
- Create issues
- Assign issues if assignee selection is used
- Set any required custom fields configured in the target project

## Relevant backend files

- `apps/api/src/jira/jira.module.ts`
- `apps/api/src/jira/jira.resolver.ts`
- `apps/api/src/jira/jira.service.ts`
- `apps/api/src/jira/dto/*`
- `apps/api/src/auth/gql-auth.guard.ts`
- `apps/api/prisma/schema.prisma`

## Relevant frontend files

- `apps/web/app/page.tsx`
- `apps/web/app/jira/callback/page.tsx`
- `apps/web/lib/graphql.ts`

## Data model

### `JiraConnection`

This table stores one Jira connection per app user.

Fields:

- `userId`
- `cloudId`
- `siteName`
- `accessToken`
- `refreshToken`
- `expiresAt`

Purpose:

- maps an app user to a Jira tenant
- stores credentials needed for future Jira API calls
- supports token refresh without reconnecting every time

### `Ticket`

This table stores a local record of each Jira issue created through the app.

Fields:

- `userId`
- `jiraIssueId`
- `jiraKey`
- `summary`
- `projectKey`
- `createdAt`

Purpose:

- gives the app a local activity/history view
- avoids fetching issue history from Jira for every dashboard render

## Authentication layers

There are two auth systems in the full flow.

### 1. App authentication

The user signs up or logs in through the app first.
The backend returns a JWT.
The frontend stores that JWT in `localStorage` as `token`.

That JWT is then sent in the GraphQL `Authorization` header:

`Authorization: Bearer <jwt>`

All Jira GraphQL operations are protected by `GqlAuthGuard`.

### 2. Jira authentication

After app login, the user connects Jira using Atlassian OAuth 3LO.
This is separate from the app JWT.

The app JWT proves who the user is inside this product.
The Jira OAuth tokens grant access to that user's Jira site.

## End-to-end flow

### Step 1: User logs in to the app

Frontend:

- route: `/`
- mutations used: `signup` or `login`
- result: app access token

Frontend behavior:

- stores the access token in `localStorage`
- uses it for later GraphQL calls

Backend behavior:

- validates credentials
- issues JWT

### Step 2: Frontend loads dashboard data

Once the JWT exists, the homepage loads the main dashboard query.

The Jira-related parts are:

- `jiraConnection`
- `jiraProjects`
- `myTickets`

What the frontend uses them for:

- `jiraConnection`: show connected or disconnected state
- `jiraProjects`: populate the project dropdown
- `myTickets`: render locally stored created issues

Backend behavior:

- reads the user's Jira connection from the database
- if connected, fetches projects using the stored Jira token
- loads local ticket records

### Step 3: User clicks "Connect Jira"

Frontend action:

- calls `beginJiraConnection`

Backend action in `createConnectUrl`:

1. builds a `state` payload containing:
   - `userId`
   - random `nonce`
2. encodes it as `base64url`
3. builds the Atlassian authorization URL with:
   - `audience=api.atlassian.com`
   - `client_id`
   - `scope`
   - `redirect_uri`
   - `state`
   - `response_type=code`
   - `prompt=consent`

Backend response:

- `authorizationUrl`
- `state`

Frontend follow-up:

- redirects the browser to Atlassian using `window.location.href`

### Step 4: User authorizes in Atlassian

The user sees the Atlassian consent screen.
After approval, Atlassian redirects back to:

- `JIRA_CALLBACK_URL`
- currently expected to be `/jira/callback` on the web app

Query params returned by Atlassian:

- `code`
- `state`

### Step 5: Frontend callback route completes the connection

Frontend route:

- `apps/web/app/jira/callback/page.tsx`

Frontend behavior:

1. reads the app JWT from `localStorage`
2. reads `code` and `state` from the URL
3. calls `completeJiraConnection`

Failure cases handled in the UI:

- missing JWT
- missing `code`
- missing `state`

### Step 6: Backend exchanges the OAuth code

Backend mutation:

- `completeJiraConnection`

Backend behavior in `completeConnection`:

1. decodes `state`
2. verifies that `state.userId` matches the authenticated app user
3. exchanges the authorization code for Jira tokens
4. calls Atlassian accessible-resources API
5. selects the first available Jira resource
6. stores or updates the Jira connection in the database

Stored values:

- `cloudId`
- `siteName`
- `accessToken`
- `refreshToken`
- `expiresAt`

Why accessible-resources is needed:

Atlassian tokens are not tied directly to a single Jira site.
The accessible-resources call tells the backend which Jira cloud sites the user can access.
The current implementation chooses the first one returned.

### Step 7: Dashboard reflects the new Jira connection

After a successful callback flow, later dashboard loads show:

- `jiraConnection.connected = true`
- `jiraConnection.siteName = <jira site name>`

Frontend impact:

- the UI changes from disconnected to connected
- the "Create Jira" flow becomes usable

## Project loading flow

The homepage dashboard query includes `jiraProjects`.

Backend behavior in `listProjects`:

1. load the user's `JiraConnection`
2. return `[]` if no Jira connection exists
3. ensure the access token is fresh
4. call:
   - `GET /rest/api/3/project/search`
5. map Jira projects into:
   - `id`
   - `key`
   - `name`

Frontend usage:

- populate the project select input
- default to the first project if the current selection is invalid

Important detail:

The form must submit the Jira project key, not the project name.
Example:

- correct: `TEST`
- incorrect: `Test Project`

## Assignee loading flow

Assignee lookup only runs when a project key is selected.

Frontend behavior:

1. when `issueForm.projectKey` changes, a request is triggered
2. the assignee dropdown can also refresh on focus
3. query used: `jiraAssignableUsers(projectKey)`

Backend behavior in `listAssignableUsers`:

1. trim the incoming project key
2. return `[]` if project key is empty
3. return `[]` if Jira is not connected
4. ensure the Jira token is fresh
5. call:
   - `GET /rest/api/3/user/assignable/search?project=<key>&maxResults=100`
6. map Jira users into:
   - `accountId`
   - `displayName`
   - `active`

Frontend usage:

- shows only active users in the dropdown
- stores the selected `accountId`

## Jira issue creation flow

### Frontend form fields

The Jira issue form collects:

- `projectKey`
- `summary`
- `description`
- `issueType`
- `labelsText`
- `priority`
- `assigneeAccountId`

Frontend preprocessing:

- `labelsText` is split by comma into a `labels` array
- empty optional fields are sent as `undefined`

Mutation used:

- `createJiraIssue`

### Backend validation

`CreateJiraIssueInput` validates:

- `projectKey` must be uppercase Jira key format
- `summary` must have a minimum length
- `description` must have a minimum length
- `issueType` is required
- optional arrays and strings are normalized

Important transformation:

- `projectKey` is trimmed and uppercased before use

### Backend issue creation

Backend behavior in `createIssue`:

1. load the user's Jira connection
2. fail if Jira is not connected
3. ensure the access token is fresh
4. call Jira issue create API:
   - `POST /rest/api/3/issue`
5. send the Jira request body with:
   - `project.key`
   - `summary`
   - `issuetype.name`
   - `labels`
   - `priority.name`
   - `assignee.accountId`
   - Atlassian document format description
6. parse Jira response
7. store a local `Ticket` row

Backend response to frontend:

- local ticket record including:
  - `id`
  - `jiraIssueId`
  - `jiraKey`
  - `summary`
  - `projectKey`
  - `createdAt`

### Description format detail

Jira issue descriptions are sent as Atlassian Document Format, not as a plain string payload.
The current implementation wraps the description text in a simple paragraph document.

## Local ticket storage flow

After Jira returns a successful issue creation response:

1. the backend extracts:
   - Jira issue ID
   - Jira issue key
2. the backend creates a `Ticket` row in PostgreSQL
3. the frontend reloads the dashboard
4. `myTickets` now includes the newly created ticket

Why this matters:

- the UI can show a ticket history without another Jira search API
- the app keeps an internal record tied to the app user

## Token refresh flow

Jira access tokens expire.
The backend handles this automatically.

Backend behavior in `ensureFreshAccessToken`:

1. load the saved `JiraConnection`
2. if the token is still valid for more than 60 seconds:
   - reuse the current access token
3. otherwise:
   - use the refresh token to obtain a new access token
4. update the saved connection in the database

Refreshed fields:

- `accessToken`
- `refreshToken` if a new one is returned
- `expiresAt`

Failure case:

If there is no refresh token, the backend throws:

- `Jira connection expired. Reconnect Jira to continue.`

## Error handling

### State mismatch

If the OAuth `state` does not belong to the authenticated user, the backend rejects the request.

Purpose:

- protects against cross-user OAuth completion

### Jira not connected

If a user tries to create an issue without a stored Jira connection, the backend returns:

- `Jira is not connected`

### Invalid project key

If Jira rejects the submitted project, the backend converts that into a clearer error:

- use the Jira project key, not the project name

### Missing callback data

If the frontend callback route does not have:

- app JWT
- `code`
- `state`

the callback page shows an error status instead of completing the flow.

### Token refresh failure

If the refresh call fails, the backend returns the Jira refresh error so the connection can be re-established.

## GraphQL API summary

### Queries

- `jiraConnection`
- `jiraProjects`
- `jiraAssignableUsers(projectKey)`
- `myTickets`

### Mutations

- `beginJiraConnection`
- `completeJiraConnection(input)`
- `createJiraIssue(input)`

## Frontend screen-level flow

### Homepage `/`

This page handles:

- app login and signup
- Jira connection status
- Jira project selection
- assignee selection
- Jira issue form submission
- rendering stored Jira tickets

### Callback page `/jira/callback`

This page handles:

- reading OAuth callback query params
- calling the backend completion mutation
- showing success or failure status
- linking back to the homepage

## Sequence summary

1. User logs in to the app.
2. Frontend stores JWT.
3. Frontend calls `beginJiraConnection`.
4. Backend returns Atlassian authorization URL.
5. Frontend redirects to Atlassian.
6. Atlassian redirects back with `code` and `state`.
7. Frontend callback calls `completeJiraConnection`.
8. Backend exchanges code, resolves Jira resource, stores connection.
9. Frontend loads dashboard data.
10. Backend returns Jira connection, projects, and local tickets.
11. Frontend optionally loads assignable users for the selected project.
12. User submits the issue form.
13. Backend refreshes token if required.
14. Backend creates the Jira issue.
15. Backend stores a local ticket record.
16. Frontend reloads dashboard and shows the new ticket.

## Current implementation decisions

### First accessible Jira site wins

The backend selects the first result from Atlassian accessible resources.
If a user has access to multiple Jira sites, the current implementation does not let them choose.

### Tickets are stored locally after creation only

The app does not currently sync all Jira issues.
It only stores issues created through this app.

### Assignee lookup depends on selected project

Assignable users are project-specific and are only queried when a valid project key is present.

## Suggested future improvements

- let the user choose among multiple accessible Jira sites
- add disconnect Jira functionality
- store more local issue metadata
- support richer Jira description content
- add retry and better UX for callback failures
- add audit logging around OAuth completion and issue creation

## Operational checklist

Before testing the Jira integration end to end, verify:

- the API is running
- the web app is running
- PostgreSQL is running
- Prisma migrations are applied
- `JIRA_CLIENT_ID` is correct
- `JIRA_CLIENT_SECRET` is correct
- `JIRA_CALLBACK_URL` matches the frontend callback route
- `NEXT_PUBLIC_GRAPHQL_URL` points to the API GraphQL endpoint
- the Atlassian app has the required Jira scopes
- the Jira user has permission to browse projects and create issues

## One-paragraph summary for Notion

This Jira integration uses app-level JWT authentication plus Atlassian OAuth 3LO. The frontend starts the connect flow, Atlassian returns an authorization code, and the backend exchanges that code for Jira tokens, resolves the user's Jira cloud site, and stores the connection in PostgreSQL. After connection, the frontend loads available Jira projects and assignable users through GraphQL. When the user submits the issue form, the backend refreshes the Jira token if needed, creates the Jira issue through the Jira REST API, stores a local ticket record, and returns that result to the frontend so the dashboard can show the newly created ticket.
