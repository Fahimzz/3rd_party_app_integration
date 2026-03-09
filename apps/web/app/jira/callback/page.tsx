'use client';

import { gql } from '@apollo/client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createApolloClient } from '../../../lib/graphql';

const COMPLETE_JIRA_CONNECTION = gql`
  mutation CompleteJiraConnection($input: CompleteJiraConnectionInput!) {
    completeJiraConnection(input: $input) {
      connected
      siteName
    }
  }
`;

export default function JiraCallbackPage() {
  const [status, setStatus] = useState('Completing Jira connection...');

  useEffect(() => {
    const token = window.localStorage.getItem('token');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!token || !code || !state) {
      setStatus('Missing token, code, or state.');
      return;
    }

    const client = createApolloClient(token);

    void client
      .mutate({
        mutation: COMPLETE_JIRA_CONNECTION,
        variables: { input: { code, state } },
      })
      .then(() => setStatus('Jira connected. You can return to the dashboard.'))
      .catch((error: Error) => setStatus(error.message));
  }, []);

  return (
    <main className="shell">
      <section className="panel">
        <h1>Jira OAuth Callback</h1>
        <p className="subtle">{status}</p>
        <Link href="/">Back to dashboard</Link>
      </section>
    </main>
  );
}
