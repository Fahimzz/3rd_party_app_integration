import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteGithubConnectionInput } from './dto/complete-github-connection.input';
import { CreateGithubIssueInput } from './dto/create-github-issue.input';

type TokenResponse = {
  access_token: string;
  token_type: string;
  scope?: string;
};

type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: { login: string };
  html_url: string;
};

type GithubRepoSummary = {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  ownerLogin: string;
  htmlUrl: string;
};

type GithubIssue = {
  id: number;
  number: number;
  html_url: string;
  title: string;
};

type GithubError = {
  message?: string;
  errors?: Array<{ message?: string } | string>;
};

type GithubAuthMode = 'oauth' | 'app';

type GithubInstallation = {
  id: number;
  permissions: Record<string, string>;
};

type GithubInstallationsResponse = {
  installations: GithubInstallation[];
};

type GithubInstallationRepositoriesResponse = {
  repositories: GithubRepo[];
};

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  createConnectUrl(userId: string) {
    const state = Buffer.from(
      JSON.stringify({ userId, nonce: crypto.randomUUID() }),
    ).toString('base64url');
    const clientId = this.configService.getOrThrow<string>('GITHUB_CLIENT_ID');
    const redirectUri = this.configService.getOrThrow<string>('GITHUB_CALLBACK_URL');
    const authMode = this.getGithubAuthMode();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      allow_signup: 'true',
    });

    if (authMode === 'oauth') {
      params.set('scope', 'repo');
    }

    return {
      authorizationUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
      state,
    };
  }

  async completeConnection(userId: string, input: CompleteGithubConnectionInput) {
    const parsedState = JSON.parse(Buffer.from(input.state, 'base64url').toString('utf8')) as {
      userId: string;
      nonce: string;
    };

    if (parsedState.userId !== userId) {
      throw new UnauthorizedException('State mismatch');
    }

    const tokenResponse = await this.exchangeCodeForTokens(input.code);
    const scopes = this.parseScopes(tokenResponse.scope);
    const isGithubAppToken = this.isGithubAppUserToken(tokenResponse.access_token);

    if (!isGithubAppToken && !scopes.includes('repo') && !scopes.includes('public_repo')) {
      throw new BadRequestException(
        'GitHub OAuth token is missing repository access. Reconnect and grant repository access, or set GITHUB_AUTH_MODE=app when using a GitHub App.',
      );
    }

    const login = await this.fetchViewerLogin(tokenResponse.access_token).catch(() => null);

    await this.prisma.githubConnection.upsert({
      where: { userId },
      update: {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type,
        scope: tokenResponse.scope ?? '',
        login,
      },
      create: {
        userId,
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type,
        scope: tokenResponse.scope ?? '',
        login,
      },
    });

    return {
      connected: true,
      login,
    };
  }

  async getConnection(userId: string) {
    const connection = await this.prisma.githubConnection.findUnique({
      where: { userId },
    });

    return {
      connected: Boolean(connection),
      login: connection?.login ?? null,
    };
  }

  async listRepos(userId: string) {
    const connection = await this.prisma.githubConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      return [];
    }

    if (this.isGithubAppUserToken(connection.accessToken)) {
      return this.listGithubAppAccessibleRepos(connection.accessToken);
    }

    const response = await fetch(
      'https://api.github.com/user/repos?per_page=100&sort=updated',
      {
        headers: this.getGithubHeaders(connection.accessToken),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`GitHub repo lookup failed: ${errorText}`);
    }

    const repos = (await response.json()) as GithubRepo[];
    return repos.map((repo) => this.mapRepo(repo));
  }

  async createIssue(userId: string, input: CreateGithubIssueInput) {
    const connection = await this.prisma.githubConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      throw new BadRequestException('GitHub is not connected');
    }

    if (this.isGithubAppUserToken(connection.accessToken)) {
      const accessibleRepos = await this.listGithubAppAccessibleRepos(connection.accessToken);
      const selectedRepo = accessibleRepos.find(
        (repo) => repo.fullName.toLowerCase() === input.repoFullName.toLowerCase(),
      );

      if (!selectedRepo) {
        throw new BadRequestException(
          'The selected repository is not accessible to the connected GitHub App. Install the app on that repository, grant Issues: Read and write, then reconnect GitHub.',
        );
      }
    }

    const response = await fetch(
      `https://api.github.com/repos/${input.repoFullName}/issues`,
      {
        method: 'POST',
        headers: this.getGithubHeaders(connection.accessToken, true),
        body: JSON.stringify({
          title: input.title,
          body: input.body ?? undefined,
          labels: input.labels?.length ? input.labels : undefined,
          assignees: input.assignees?.length ? input.assignees : undefined,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let formattedError = errorText;

      try {
        const parsedError = JSON.parse(errorText) as GithubError;
        if (parsedError.message) {
          formattedError = parsedError.message;
        }
      } catch {
        // Keep raw error text.
      }

      if (formattedError.includes('Resource not accessible by integration')) {
        formattedError = this.isGithubAppUserToken(connection.accessToken)
          ? 'Resource not accessible by integration. Ensure the GitHub App has Issues: Read and write permission, is installed on the selected repository, and the connected GitHub user can access that installation.'
          : 'Resource not accessible by integration. Ensure the OAuth token has repository access, the user has write access to the repository, and the OAuth app is approved by the organization if access is restricted.';
      }

      throw new BadRequestException(`GitHub issue creation failed: ${formattedError}`);
    }

    const issue = (await response.json()) as GithubIssue;

    return {
      id: String(issue.id),
      number: issue.number,
      url: issue.html_url,
      title: issue.title,
    };
  }

  private async exchangeCodeForTokens(code: string) {
    const clientId = this.configService.getOrThrow<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.configService.getOrThrow<string>('GITHUB_CLIENT_SECRET');
    const redirectUri = this.configService.getOrThrow<string>('GITHUB_CALLBACK_URL');

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`GitHub token exchange failed: ${errorText}`);
    }

    return (await response.json()) as TokenResponse;
  }

  private async fetchViewerLogin(accessToken: string) {
    const response = await fetch('https://api.github.com/user', {
      headers: this.getGithubHeaders(accessToken),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`GitHub user lookup failed: ${errorText}`);
    }

    const user = (await response.json()) as { login: string };
    return user.login;
  }

  private async listGithubAppAccessibleRepos(accessToken: string) {
    const installations = await this.fetchGithubAppInstallations(accessToken);
    const writableIssueInstallations = installations.filter(
      (installation) => installation.permissions.issues === 'write',
    );

    if (!writableIssueInstallations.length) {
      return [];
    }

    const repoLists = await Promise.all(
      writableIssueInstallations.map((installation) =>
        this.fetchGithubAppInstallationRepos(accessToken, installation.id),
      ),
    );

    const reposById = new Map<string, GithubRepoSummary>();
    for (const repo of repoLists.flat()) {
      reposById.set(String(repo.id), this.mapRepo(repo));
    }

    return Array.from(reposById.values()).sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    );
  }

  private async fetchGithubAppInstallations(accessToken: string) {
    const response = await fetch('https://api.github.com/user/installations?per_page=100', {
      headers: this.getGithubHeaders(accessToken),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`GitHub installation lookup failed: ${errorText}`);
    }

    const result = (await response.json()) as GithubInstallationsResponse;
    return result.installations;
  }

  private async fetchGithubAppInstallationRepos(accessToken: string, installationId: number) {
    const response = await fetch(
      `https://api.github.com/user/installations/${installationId}/repositories?per_page=100`,
      {
        headers: this.getGithubHeaders(accessToken),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(`GitHub installation repository lookup failed: ${errorText}`);
    }

    const result = (await response.json()) as GithubInstallationRepositoriesResponse;
    return result.repositories;
  }

  private getGithubAuthMode(): GithubAuthMode {
    const configuredMode = this.configService.get<string>('GITHUB_AUTH_MODE');

    if (!configuredMode) {
      return 'oauth';
    }

    const normalizedMode = configuredMode.trim().toLowerCase();
    if (normalizedMode === 'oauth' || normalizedMode === 'app') {
      return normalizedMode;
    }

    throw new InternalServerErrorException(
      'GITHUB_AUTH_MODE must be either "oauth" or "app".',
    );
  }

  private parseScopes(scope?: string) {
    return (scope ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private isGithubAppUserToken(accessToken: string) {
    return accessToken.startsWith('ghu_');
  }

  private getGithubHeaders(accessToken: string, includeJsonBody = false) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    if (includeJsonBody) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  private mapRepo(repo: GithubRepo): GithubRepoSummary {
    return {
      id: String(repo.id),
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      ownerLogin: repo.owner.login,
      htmlUrl: repo.html_url,
    };
  }
}
