'use client';

import { gql } from '@apollo/client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createApolloClient } from '../lib/graphql';

const SIGNUP = gql`
  mutation Signup($input: SignupInput!) {
    signup(input: $input) {
      accessToken
    }
  }
`;

const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const DASHBOARD = gql`
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
`;

const BEGIN_JIRA_CONNECTION = gql`
  mutation BeginJiraConnection {
    beginJiraConnection {
      authorizationUrl
      state
    }
  }
`;

const CREATE_ISSUE = gql`
  mutation CreateJiraIssue($input: CreateJiraIssueInput!) {
    createJiraIssue(input: $input) {
      id
      jiraKey
      summary
      projectKey
      createdAt
    }
  }
`;

const ASSIGNABLE_USERS = gql`
  query AssignableUsers($projectKey: String) {
    jiraAssignableUsers(projectKey: $projectKey) {
      accountId
      displayName
      active
    }
  }
`;

const BEGIN_GITHUB_CONNECTION = gql`
  mutation BeginGithubConnection {
    beginGithubConnection {
      authorizationUrl
      state
    }
  }
`;

const CREATE_GITHUB_ISSUE = gql`
  mutation CreateGithubIssue($input: CreateGithubIssueInput!) {
    createGithubIssue(input: $input) {
      id
      number
      url
      title
    }
  }
`;

type DashboardData = {
  me: { id: string; email: string };
  jiraConnection: { connected: boolean; siteName?: string | null };
  jiraProjects: Array<{ id: string; key: string; name: string }>;
  myTickets: Array<{
    id: string;
    jiraKey: string;
    summary: string;
    projectKey: string;
    createdAt: string;
  }>;
  githubConnection: { connected: boolean; login?: string | null };
  githubRepos: Array<{
    id: string;
    name: string;
    fullName: string;
    ownerLogin: string;
    htmlUrl: string;
    private: boolean;
  }>;
};

export default function HomePage() {
  const priorityOptions = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState('');
  const [isLoadingAssignees, setIsLoadingAssignees] = useState(false);
  const [assignees, setAssignees] = useState<
    Array<{ accountId: string; displayName: string; active: boolean }>
  >([]);
  const [issueForm, setIssueForm] = useState({
    projectKey: '',
    summary: '',
    description: '',
    issueType: 'Task',
    labelsText: '',
    priority: '',
    assigneeAccountId: '',
  });
  const [githubIssueForm, setGithubIssueForm] = useState({
    repoFullName: '',
    title: '',
    body: '',
    labelsText: '',
    assigneesText: '',
  });

  useEffect(() => {
    const savedToken = window.localStorage.getItem('token');
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setDashboard(null);
      return;
    }

    window.localStorage.setItem('token', token);
    void loadDashboard(token);
  }, [token]);

  useEffect(() => {
    if (!token || !issueForm.projectKey) {
      setAssignees([]);
      return;
    }

    void loadAssignableUsers(token, issueForm.projectKey);
  }, [token, issueForm.projectKey]);

  async function loadDashboard(currentToken: string) {
    const client = createApolloClient(currentToken);
    const result = await client.query<DashboardData>({
      query: DASHBOARD,
      fetchPolicy: 'no-cache',
    });

    setDashboard(result.data);
    setIssueForm((current) => {
      const defaultProjectKey = result.data.jiraProjects[0]?.key ?? '';
      const selectedProjectStillExists = result.data.jiraProjects.some(
        (project) => project.key === current.projectKey,
      );

      if (selectedProjectStillExists) {
        return current;
      }

      return { ...current, projectKey: defaultProjectKey, assigneeAccountId: '' };
    });
    setGithubIssueForm((current) => {
      const defaultRepo = result.data.githubRepos[0]?.fullName ?? '';
      const selectedRepoStillExists = result.data.githubRepos.some(
        (repo) => repo.fullName === current.repoFullName,
      );

      if (selectedRepoStillExists) {
        return current;
      }

      return { ...current, repoFullName: defaultRepo };
    });
  }

  async function loadAssignableUsers(currentToken: string, projectKey?: string) {
    if (!projectKey) {
      setAssignees([]);
      return;
    }

    setIsLoadingAssignees(true);
    try {
      const client = createApolloClient(currentToken);
      const result = await client.query<{
        jiraAssignableUsers: Array<{ accountId: string; displayName: string; active: boolean }>;
      }>({
        query: ASSIGNABLE_USERS,
        variables: { projectKey },
        fetchPolicy: 'no-cache',
      });

      setAssignees(result.data.jiraAssignableUsers);
    } catch (error) {
      setAssignees([]);
      setStatus(error instanceof Error ? error.message : 'Failed to load Jira assignees');
    } finally {
      setIsLoadingAssignees(false);
    }
  }

  async function handleAuth(mode: 'signup' | 'login') {
    setStatus(mode === 'signup' ? 'Creating account...' : 'Logging in...');

    try {
      const client = createApolloClient();
      const result = await client.mutate<{
        signup?: { accessToken: string };
        login?: { accessToken: string };
      }>({
        mutation: mode === 'signup' ? SIGNUP : LOGIN,
        variables: {
          input: { email, password },
        },
      });

      const accessToken = result.data?.signup?.accessToken ?? result.data?.login?.accessToken;

      if (!accessToken) {
        throw new Error('No token returned');
      }

      setToken(accessToken);
      setStatus('Authenticated');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Authentication failed');
    }
  }

  async function handleConnectJira() {
    if (!token) {
      return;
    }

    setStatus('Preparing Jira connection...');

    try {
      const client = createApolloClient(token);
      const result = await client.mutate<{
        beginJiraConnection: { authorizationUrl: string };
      }>({
        mutation: BEGIN_JIRA_CONNECTION,
      });

      const url = result.data?.beginJiraConnection.authorizationUrl;

      if (!url) {
        throw new Error('Missing Jira authorization URL');
      }

      window.location.href = url;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not start Jira connection');
    }
  }

  async function handleConnectGithub() {
    if (!token) {
      return;
    }

    setStatus('Preparing GitHub connection...');

    try {
      const client = createApolloClient(token);
      const result = await client.mutate<{
        beginGithubConnection: { authorizationUrl: string };
      }>({
        mutation: BEGIN_GITHUB_CONNECTION,
      });

      const url = result.data?.beginGithubConnection.authorizationUrl;

      if (!url) {
        throw new Error('Missing GitHub authorization URL');
      }

      window.location.href = url;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not start GitHub connection');
    }
  }

  async function handleCreateIssue() {
    if (!token) {
      return;
    }

    setStatus('Creating Jira issue...');

    try {
      const labels = issueForm.labelsText
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);

      const client = createApolloClient(token);
      await client.mutate({
        mutation: CREATE_ISSUE,
        variables: {
          input: {
            projectKey: issueForm.projectKey,
            summary: issueForm.summary,
            description: issueForm.description,
            issueType: issueForm.issueType,
            labels,
            priority: issueForm.priority || undefined,
            assigneeAccountId: issueForm.assigneeAccountId || undefined,
          },
        },
      });

      await loadDashboard(token);
      setIssueForm((current) => ({
        ...current,
        summary: '',
        description: '',
        issueType: 'Task',
        labelsText: '',
        priority: '',
        assigneeAccountId: '',
      }));
      setStatus('Issue created');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Issue creation failed');
    }
  }

  async function handleCreateGithubIssue() {
    if (!token) {
      return;
    }

    setStatus('Creating GitHub issue...');

    try {
      const labels = githubIssueForm.labelsText
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
      const assignees = githubIssueForm.assigneesText
        .split(',')
        .map((assignee) => assignee.trim())
        .filter(Boolean);

      const client = createApolloClient(token);
      const result = await client.mutate<{
        createGithubIssue: { id: string; number: number; url: string; title: string };
      }>({
        mutation: CREATE_GITHUB_ISSUE,
        variables: {
          input: {
            repoFullName: githubIssueForm.repoFullName,
            title: githubIssueForm.title,
            body: githubIssueForm.body || undefined,
            labels: labels.length ? labels : undefined,
            assignees: assignees.length ? assignees : undefined,
          },
        },
      });

      const created = result.data?.createGithubIssue;
      if (created) {
        setStatus(`GitHub issue #${created.number} created`);
      } else {
        setStatus('GitHub issue created');
      }

      setGithubIssueForm((current) => ({
        ...current,
        title: '',
        body: '',
        labelsText: '',
        assigneesText: '',
      }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'GitHub issue creation failed');
    }
  }

  function signOut() {
    window.localStorage.removeItem('token');
    setToken(null);
    setStatus('Signed out');
  }

  const projectOptions = dashboard?.jiraProjects ?? [];
  const githubRepos = dashboard?.githubRepos ?? [];
  const hasNoGithubRepos = Boolean(dashboard?.githubConnection.connected && !githubRepos.length);

  return (
    <main className="shell">
      <section className="hero">
        <h1>Jira + GitHub Ticket Flow</h1>
        <p>
          Minimal MVP with Next.js on the frontend and NestJS GraphQL on the backend. Users sign
          in, connect their Jira and GitHub accounts, and create issues that are also stored locally
          for Jira.
        </p>
        <p className="subtle">
          <Link href="/jira-walkthrough">Open OAuth walkthrough route</Link>
        </p>
      </section>

      <div className="grid">
        <section className="panel">
          <h2>Authentication</h2>
          <div className="stack">
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="stack">
              <button className="button" onClick={() => void handleAuth('signup')}>
                Sign up
              </button>
              <button className="button" onClick={() => void handleAuth('login')}>
                Log in
              </button>
              {token ? (
                <button className="button" onClick={signOut}>
                  Sign out
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Jira Connection</h2>
          <p className="subtle">
            {dashboard?.jiraConnection.connected
              ? `Connected to ${dashboard.jiraConnection.siteName ?? 'your Jira site'}.`
              : 'No Jira account connected yet.'}
          </p>
          <button className="button" disabled={!token} onClick={() => void handleConnectJira()}>
            Connect Jira
          </button>
        </section>

        <section className="panel">
          <h2>GitHub Connection</h2>
          <p className="subtle">
            {dashboard?.githubConnection.connected
              ? `Connected as ${dashboard.githubConnection.login ?? 'GitHub user'}.`
              : 'No GitHub account connected yet.'}
          </p>
          {hasNoGithubRepos ? (
            <p className="subtle">
              No repositories are currently accessible. Install the GitHub App on the target
              account or organization, grant repository issue write access, then reconnect GitHub.
            </p>
          ) : null}
          <button className="button" disabled={!token} onClick={() => void handleConnectGithub()}>
            Connect GitHub
          </button>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Create Jira Ticket</h2>
          <div className="stack">
            <label className="field">
              <span>Project key</span>
              <select
                value={issueForm.projectKey}
                onChange={(event) =>
                  setIssueForm((current) => ({
                    ...current,
                    projectKey: event.target.value,
                    assigneeAccountId: '',
                  }))
                }
                disabled={!projectOptions.length}
              >
                <option value="" disabled>
                  {projectOptions.length ? 'Select a Jira project' : 'No Jira projects found'}
                </option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.key}>
                    {project.name} ({project.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Summary</span>
              <input
                value={issueForm.summary}
                onChange={(event) =>
                  setIssueForm((current) => ({ ...current, summary: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                value={issueForm.description}
                onChange={(event) =>
                  setIssueForm((current) => ({ ...current, description: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Issue type</span>
              <input
                value={issueForm.issueType}
                onChange={(event) =>
                  setIssueForm((current) => ({ ...current, issueType: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Priority (optional)</span>
              <select
                value={issueForm.priority}
                onChange={(event) =>
                  setIssueForm((current) => ({ ...current, priority: event.target.value }))
                }
              >
                <option value="">No priority</option>
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Assignee (optional)</span>
              <select
                value={issueForm.assigneeAccountId}
                onChange={(event) =>
                  setIssueForm((current) => ({
                    ...current,
                    assigneeAccountId: event.target.value,
                  }))
                }
                onFocus={() => {
                  if (token && issueForm.projectKey) {
                    void loadAssignableUsers(token, issueForm.projectKey);
                  }
                }}
                disabled={!issueForm.projectKey}
              >
                <option value="">
                  {isLoadingAssignees
                    ? 'Loading assignees...'
                    : assignees.length
                      ? 'Unassigned'
                      : 'No assignable users'}
                </option>
                {assignees
                  .filter((assignee) => assignee.active)
                  .map((assignee) => (
                    <option key={assignee.accountId} value={assignee.accountId}>
                      {assignee.displayName}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Labels (comma separated)</span>
              <input
                value={issueForm.labelsText}
                onChange={(event) =>
                  setIssueForm((current) => ({ ...current, labelsText: event.target.value }))
                }
                placeholder="bug, customer, urgent"
              />
            </label>
            <button
              className="button"
              disabled={!dashboard?.jiraConnection.connected || !issueForm.projectKey}
              onClick={() => void handleCreateIssue()}
            >
              Create in Jira
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Stored Jira Tickets</h2>
          <div className="stack">
            {dashboard?.myTickets.length ? (
              dashboard.myTickets.map((ticket) => (
                <article className="ticket" key={ticket.id}>
                  <strong>
                    {ticket.jiraKey} · {ticket.summary}
                  </strong>
                  <div className="subtle">
                    Project {ticket.projectKey} · {new Date(ticket.createdAt).toLocaleString()}
                  </div>
                </article>
              ))
            ) : (
              <p className="subtle">No tickets stored yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Create GitHub Issue</h2>
          <div className="stack">
            {hasNoGithubRepos ? (
              <p className="subtle">
                In GitHub App mode, only repositories where the app is installed and allowed to
                write issues will appear here.
              </p>
            ) : null}
            <label className="field">
              <span>Repository</span>
              <select
                value={githubIssueForm.repoFullName}
                onChange={(event) =>
                  setGithubIssueForm((current) => ({
                    ...current,
                    repoFullName: event.target.value,
                  }))
                }
                disabled={!githubRepos.length}
              >
                <option value="" disabled>
                  {githubRepos.length ? 'Select a GitHub repo' : 'No GitHub repos found'}
                </option>
                {githubRepos.map((repo) => (
                  <option key={repo.id} value={repo.fullName}>
                    {repo.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Title</span>
              <input
                value={githubIssueForm.title}
                onChange={(event) =>
                  setGithubIssueForm((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Body (optional)</span>
              <textarea
                value={githubIssueForm.body}
                onChange={(event) =>
                  setGithubIssueForm((current) => ({ ...current, body: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Labels (comma separated)</span>
              <input
                value={githubIssueForm.labelsText}
                onChange={(event) =>
                  setGithubIssueForm((current) => ({ ...current, labelsText: event.target.value }))
                }
                placeholder="bug, customer, urgent"
              />
            </label>
            <label className="field">
              <span>Assignees (comma separated usernames)</span>
              <input
                value={githubIssueForm.assigneesText}
                onChange={(event) =>
                  setGithubIssueForm((current) => ({
                    ...current,
                    assigneesText: event.target.value,
                  }))
                }
                placeholder="octocat"
              />
            </label>
            <button
              className="button"
              disabled={!dashboard?.githubConnection.connected || !githubIssueForm.repoFullName}
              onClick={() => void handleCreateGithubIssue()}
            >
              Create on GitHub
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>GitHub Repositories</h2>
          <div className="stack">
            {githubRepos.length ? (
              githubRepos.map((repo) => (
                <article className="ticket" key={repo.id}>
                  <strong>
                    <a href={repo.htmlUrl} target="_blank" rel="noreferrer">
                      {repo.fullName}
                    </a>
                  </strong>
                  <div className="subtle">
                    {repo.private ? 'Private' : 'Public'} · Owner {repo.ownerLogin}
                  </div>
                </article>
              ))
            ) : (
              <p className="subtle">
                {hasNoGithubRepos
                  ? 'No repositories are accessible to the connected GitHub App yet.'
                  : 'No repositories available.'}
              </p>
            )}
          </div>
        </section>
      </div>

      <p className="status">{status}</p>
    </main>
  );
}

