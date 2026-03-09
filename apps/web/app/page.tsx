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

  function signOut() {
    window.localStorage.removeItem('token');
    setToken(null);
    setStatus('Signed out');
  }

  const projectOptions = dashboard?.jiraProjects ?? [];

  return (
    <main className="shell">
      <section className="hero">
        <h1>Jira Ticket Flow</h1>
        <p>
          Minimal MVP with Next.js on the frontend and NestJS GraphQL on the backend. Users sign
          in, connect their own Jira account, and create tickets that are also stored locally.
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
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Create Ticket</h2>
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
          <h2>Stored Tickets</h2>
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

      <p className="status">{status}</p>
    </main>
  );
}
