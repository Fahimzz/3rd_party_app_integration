'use client';

import { gql } from '@apollo/client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createApolloClient } from '../../lib/graphql';

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
  query WalkthroughDashboard {
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

export default function JiraWalkthroughPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [status, setStatus] = useState('');
  const [issueForm, setIssueForm] = useState({
    projectKey: '',
    summary: '',
    description: '',
    issueType: 'Task',
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

  async function loadDashboard(currentToken: string) {
    const client = createApolloClient(currentToken);
    const result = await client.query<DashboardData>({
      query: DASHBOARD,
      fetchPolicy: 'no-cache',
    });

    setDashboard(result.data);
    setIssueForm((current) => {
      if (current.projectKey || !result.data.jiraProjects.length) {
        return current;
      }

      return { ...current, projectKey: result.data.jiraProjects[0].key };
    });
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
        variables: { input: { email, password } },
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

    setStatus('Redirecting to Jira login/consent...');
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
      const client = createApolloClient(token);
      await client.mutate({
        mutation: CREATE_ISSUE,
        variables: {
          input: {
            projectKey: issueForm.projectKey,
            summary: issueForm.summary,
            description: issueForm.description,
            issueType: issueForm.issueType,
          },
        },
      });

      await loadDashboard(token);
      setIssueForm((current) => ({
        ...current,
        summary: '',
        description: '',
        issueType: 'Task',
      }));
      setStatus('Issue created');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Issue creation failed');
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <h1>Jira OAuth Walkthrough</h1>
        <p>
          This route demonstrates the real multi-user flow. Users do not provide client ID, client
          secret, or callback URL. They only log in and click Connect Jira.
        </p>
        <p className="subtle">
          <Link href="/">Back to home</Link>
        </p>
      </section>

      <div className="grid">
        <section className="panel">
          <h2>Step 1: App Login</h2>
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
            <button className="button" onClick={() => void handleAuth('signup')}>
              Sign up
            </button>
            <button className="button" onClick={() => void handleAuth('login')}>
              Log in
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Step 2: Connect Jira</h2>
          <p className="subtle">
            {dashboard?.jiraConnection.connected
              ? `Connected to ${dashboard.jiraConnection.siteName ?? 'your Jira site'}.`
              : 'Not connected yet.'}
          </p>
          <button className="button" disabled={!token} onClick={() => void handleConnectJira()}>
            Connect Jira
          </button>
        </section>
      </div>

      <div className="grid">
        <section className="panel">
          <h2>Step 3: Choose Project</h2>
          <div className="stack">
            <label className="field">
              <span>Project key</span>
              <select
                value={issueForm.projectKey}
                onChange={(event) =>
                  setIssueForm((current) => ({ ...current, projectKey: event.target.value }))
                }
                disabled={!dashboard?.jiraProjects.length}
              >
                <option value="" disabled>
                  {dashboard?.jiraProjects.length ? 'Select project' : 'No projects found'}
                </option>
                {dashboard?.jiraProjects.map((project) => (
                  <option key={project.id} value={project.key}>
                    {project.name} ({project.key})
                  </option>
                ))}
              </select>
            </label>
            <button className="button" disabled={!token} onClick={() => token && void loadDashboard(token)}>
              Refresh projects
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Step 4: Create Issue</h2>
          <div className="stack">
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
            <button
              className="button"
              disabled={!dashboard?.jiraConnection.connected || !issueForm.projectKey}
              onClick={() => void handleCreateIssue()}
            >
              Create in Jira
            </button>
          </div>
        </section>
      </div>

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

      <p className="status">{status}</p>
    </main>
  );
}
