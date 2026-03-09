import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteJiraConnectionInput } from './dto/complete-jira-connection.input';
import { CreateJiraIssueInput } from './dto/create-jira-issue.input';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type AccessibleResource = {
  id: string;
  name: string;
};

type JiraIssueErrorResponse = {
  errorMessages?: string[];
  errors?: Record<string, string>;
};

type JiraProject = {
  id: string;
  key: string;
  name: string;
};

type JiraProjectSearchResponse = {
  values: JiraProject[];
};

type JiraAssignableUser = {
  accountId: string;
  displayName: string;
  active: boolean;
};

@Injectable()
export class JiraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  createConnectUrl(userId: string) {
    const state = Buffer.from(
      JSON.stringify({ userId, nonce: crypto.randomUUID() }),
    ).toString('base64url');
    const clientId = this.configService.getOrThrow<string>('JIRA_CLIENT_ID');
    const redirectUri = this.configService.getOrThrow<string>('JIRA_CALLBACK_URL');
    const scope = ['manage:jira-webhook', 'read:jira-work', 'write:jira-work'].join(' ');

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: clientId,
      scope,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });

    return {
      authorizationUrl: `https://auth.atlassian.com/authorize?${params.toString()}`,
      state,
    };
  }

  async completeConnection(userId: string, input: CompleteJiraConnectionInput) {
    const parsedState = JSON.parse(Buffer.from(input.state, 'base64url').toString('utf8')) as {
      userId: string;
      nonce: string;
    };

    if (parsedState.userId !== userId) {
      throw new UnauthorizedException('State mismatch');
    }

    const tokenResponse = await this.exchangeCodeForTokens(input.code);
    const resource = await this.getPrimaryResource(tokenResponse.access_token);

    await this.prisma.jiraConnection.upsert({
      where: { userId },
      update: {
        cloudId: resource.id,
        siteName: resource.name,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token ?? '',
        expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
      },
      create: {
        userId,
        cloudId: resource.id,
        siteName: resource.name,
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token ?? '',
        expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
      },
    });

    return {
      connected: true,
      siteName: resource.name,
    };
  }

  async getConnection(userId: string) {
    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId },
    });

    return {
      connected: Boolean(connection),
      siteName: connection?.siteName ?? null,
    };
  }

  async createIssue(userId: string, input: CreateJiraIssueInput) {
    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException('Jira is not connected');
    }

    const accessToken = await this.ensureFreshAccessToken(connection.userId);
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${connection.cloudId}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            project: { key: input.projectKey },
            summary: input.summary,
            issuetype: { name: input.issueType },
            labels: input.labels?.length ? input.labels : undefined,
            priority: input.priority ? { name: input.priority } : undefined,
            assignee: input.assigneeAccountId ? { accountId: input.assigneeAccountId } : undefined,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: input.description }],
                },
              ],
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let formattedError = errorText;

      try {
        const parsedError = JSON.parse(errorText) as JiraIssueErrorResponse;
        const projectError = parsedError.errors?.project;

        if (projectError) {
          formattedError = `Invalid Jira project key "${input.projectKey}". Use the project key (e.g. TEST), not the project name.`;
        } else if (parsedError.errorMessages?.length) {
          formattedError = parsedError.errorMessages.join('; ');
        }
      } catch {
        // Keep raw error text if Jira didn't return JSON.
      }

      throw new BadRequestException(`Jira issue creation failed: ${formattedError}`);
    }

    const issue = (await response.json()) as { id: string; key: string };

    return this.prisma.ticket.create({
      data: {
        userId,
        jiraIssueId: issue.id,
        jiraKey: issue.key,
        summary: input.summary,
        projectKey: input.projectKey,
      },
    });
  }

  async listTickets(userId: string) {
    return this.prisma.ticket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listProjects(userId: string) {
    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      return [];
    }

    const accessToken = await this.ensureFreshAccessToken(connection.userId);
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${connection.cloudId}/rest/api/3/project/search`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`Jira project lookup failed: ${errorText}`);
    }

    const result = (await response.json()) as JiraProjectSearchResponse;
    return result.values.map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
    }));
  }

  async listAssignableUsers(userId: string, projectKey?: string) {
    const trimmedProjectKey = projectKey?.trim();
    if (!trimmedProjectKey) {
      return [];
    }

    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      return [];
    }

    const accessToken = await this.ensureFreshAccessToken(connection.userId);
    const params = new URLSearchParams({
      project: trimmedProjectKey,
      maxResults: '100',
    });

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${connection.cloudId}/rest/api/3/user/assignable/search?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`Jira assignee lookup failed: ${errorText}`);
    }

    const users = (await response.json()) as JiraAssignableUser[];
    return users.map((user) => ({
      accountId: user.accountId,
      displayName: user.displayName,
      active: user.active,
    }));
  }

  private async ensureFreshAccessToken(userId: string) {
    const connection = await this.prisma.jiraConnection.findUniqueOrThrow({
      where: { userId },
    });

    if (connection.expiresAt.getTime() > Date.now() + 60_000) {
      return connection.accessToken;
    }
    if (!connection.refreshToken) {
      throw new UnauthorizedException(
        'Jira connection expired. Reconnect Jira to continue.',
      );
    }

    const clientId = this.configService.getOrThrow<string>('JIRA_CLIENT_ID');
    const clientSecret = this.configService.getOrThrow<string>('JIRA_CLIENT_SECRET');

    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`Failed to refresh Jira token: ${errorText}`);
    }

    const tokenResponse = (await response.json()) as TokenResponse;

    const updated = await this.prisma.jiraConnection.update({
      where: { userId },
      data: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token ?? connection.refreshToken,
        expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
      },
    });

    return updated.accessToken;
  }

  private async exchangeCodeForTokens(code: string) {
    const clientId = this.configService.getOrThrow<string>('JIRA_CLIENT_ID');
    const clientSecret = this.configService.getOrThrow<string>('JIRA_CLIENT_SECRET');
    const redirectUri = this.configService.getOrThrow<string>('JIRA_CALLBACK_URL');

    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`Jira token exchange failed: ${errorText}`);
    }

    return (await response.json()) as TokenResponse;
  }

  private async getPrimaryResource(accessToken: string) {
    const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`Jira resource lookup failed: ${errorText}`);
    }

    const resources = (await response.json()) as AccessibleResource[];
    const resource = resources[0];

    if (!resource) {
      throw new BadRequestException('No Jira site available for this account');
    }

    return resource;
  }
}
