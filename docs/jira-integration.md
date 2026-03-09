# Jira Integration API Guide

This document provides GraphQL examples for the Jira integration flow in this project.

Base endpoint (local):

- `http://localhost:4000/graphql`

Auth:

- Protected operations require `Authorization: Bearer <accessToken>`.

## 1. Sign up or log in

### Signup

```graphql
mutation Signup($input: SignupInput!) {
  signup(input: $input) {
    accessToken
  }
}
```

Variables:

```json
{
  "input": {
    "email": "dev@example.com",
    "password": "supersecret"
  }
}
```

### Login

```graphql
mutation Login($input: LoginInput!) {
  login(input: $input) {
    accessToken
  }
}
```

Variables:

```json
{
  "input": {
    "email": "dev@example.com",
    "password": "supersecret"
  }
}
```

## 2. Start Jira OAuth

```graphql
mutation BeginJiraConnection {
  beginJiraConnection {
    authorizationUrl
    state
  }
}
```

Use the returned `authorizationUrl` in browser redirect.

## 3. Complete Jira OAuth callback

After Atlassian redirects to:

- `http://localhost:3000/jira/callback?code=...&state=...`

Call:

```graphql
mutation CompleteJiraConnection($input: CompleteJiraConnectionInput!) {
  completeJiraConnection(input: $input) {
    connected
    siteName
  }
}
```

Variables:

```json
{
  "input": {
    "code": "<code-from-callback>",
    "state": "<state-from-callback>"
  }
}
```

## 4. Read dashboard data

```graphql
query Dashboard {
  me {
    id
    email
  }
  jiraConnection {
    connected
    siteName
  }
  jiraProjects {
    id
    key
    name
  }
  myTickets {
    id
    jiraKey
    summary
    projectKey
    createdAt
  }
}
```

## 5. Fetch assignees by project

```graphql
query AssignableUsers($projectKey: String) {
  jiraAssignableUsers(projectKey: $projectKey) {
    accountId
    displayName
    active
  }
}
```

Variables:

```json
{
  "projectKey": "TEST"
}
```

Notes:

- If `projectKey` is missing/empty, response is an empty array.
- Assignees depend on Jira project permissions.

## 6. Create Jira issue

```graphql
mutation CreateJiraIssue($input: CreateJiraIssueInput!) {
  createJiraIssue(input: $input) {
    id
    jiraIssueId
    jiraKey
    summary
    projectKey
    createdAt
  }
}
```

Variables (full example):

```json
{
  "input": {
    "projectKey": "TEST",
    "summary": "API integration test issue",
    "description": "Created via GraphQL mutation",
    "issueType": "Task",
    "priority": "High",
    "labels": ["api", "integration"],
    "assigneeAccountId": "712020:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  }
}
```

Minimal variables:

```json
{
  "input": {
    "projectKey": "TEST",
    "summary": "Minimal issue",
    "description": "Only required fields",
    "issueType": "Task"
  }
}
```

## 7. Common errors

### Scope error

Example:

- Missing scopes like `manage:jira-webhook`, `read:jira-work`, or `write:jira-work`.

Fix:

1. Add scope in Atlassian OAuth app.
2. Reconnect Jira to re-consent.

### Invalid project

Example:

- `Jira issue creation failed: ... valid project is required`

Fix:

1. Use a valid project from `jiraProjects`.
2. Ensure the connected Jira site has that project.

### Empty assignees

Cause:

- User not assignable in project permission scheme.

Fix:

1. Check project permissions in Jira.
2. Reconnect Jira if token/scope permissions changed.
