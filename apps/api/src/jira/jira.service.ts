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

type JiraDescriptionDocument = {
  type: 'doc';
  version: 1;
  content: Array<Record<string, unknown>>;
};

type UploadedJiraAttachment = {
  id: string;
  filename: string;
  content?: string;
  mimeType?: string;
  thumbnail?: string;
};

type ParsedInlineImage = {
  id: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  width?: number;
  height?: number;
};

type UploadedInlineImage = {
  attachment: UploadedJiraAttachment;
  image: ParsedInlineImage;
};

type InlineImageDescription = {
  attachment: UploadedJiraAttachment;
  image: ParsedInlineImage;
  asLink?: boolean;
};

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

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
    const scope = [
      'manage:jira-webhook',
      'read:jira-user',
      'read:jira-work',
      'write:jira-work',
    ].join(' ');

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

    const inlineImages = this.parseInlineImages(input);
    const accessToken = await this.ensureFreshAccessToken(connection.userId);
    const richDescription = this.resolveDescriptionDocument(input);
    const description = this.replacePendingImageNodes(
      richDescription,
      new Map(),
      new Map(inlineImages.map((image) => [image.id, image])),
      'placeholder',
    ) as JiraDescriptionDocument;
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
            description,
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
    let notice: string | undefined;

    if (inlineImages.length) {
      notice = await this.attachInlineImages({
        accessToken,
        cloudId: connection.cloudId,
        description: richDescription,
        issueKey: issue.key,
        inlineImages,
      });
    }

    const ticket = await this.prisma.ticket.create({
      data: {
        userId,
        jiraIssueId: issue.id,
        jiraKey: issue.key,
        summary: input.summary,
        projectKey: input.projectKey,
      },
    });

    return { ...ticket, notice };
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
    console.log('Assignable users:', users); // Debugging line to log the response
    return users.map((user) => ({
      accountId: user.accountId,
      displayName: user.displayName,
      active: user.active,
    }));
  }

  private parseInlineImages(input: CreateJiraIssueInput): ParsedInlineImage[] {
    const images = [
      ...(input.inlineImages ?? []),
      ...(input.inlineImageDataUrl
        ? [
            {
              id: 'legacy-inline-image',
              dataUrl: input.inlineImageDataUrl,
              filename: input.inlineImageFilename ?? 'jira-inline-image.png',
              width: input.inlineImageWidth,
              height: input.inlineImageHeight,
            },
          ]
        : []),
    ];

    const parsedImages = images.map((image) => this.parseInlineImageData(image));
    const totalBytes = parsedImages.reduce((sum, image) => sum + image.buffer.byteLength, 0);

    if (totalBytes > MAX_TOTAL_INLINE_IMAGE_BYTES) {
      throw new BadRequestException('Rich text images must be 5 MB or smaller in total');
    }

    return parsedImages;
  }

  private parseInlineImageData(input: {
    id: string;
    dataUrl: string;
    filename?: string;
    width?: number;
    height?: number;
  }): ParsedInlineImage {
    const dataUrl = input.dataUrl?.trim();
    if (!dataUrl) {
      throw new BadRequestException('Inline image is missing image data');
    }

    const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
    if (!match) {
      throw new BadRequestException('Inline image must be an image data URL');
    }

    const mimeType = match[1].toLowerCase();
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.byteLength) {
      throw new BadRequestException('Inline image is empty');
    }

    if (buffer.byteLength > MAX_INLINE_IMAGE_BYTES) {
      throw new BadRequestException('Inline image must be 5 MB or smaller');
    }

    return {
      id: input.id,
      buffer,
      filename:
        this.sanitizeFilename(input.filename) ??
        `jira-inline-image.${this.extensionForMimeType(mimeType)}`,
      mimeType,
      width: input.width,
      height: input.height,
    };
  }

  private async attachInlineImages({
    accessToken,
    cloudId,
    description,
    issueKey,
    inlineImages,
  }: {
    accessToken: string;
    cloudId: string;
    description: JiraDescriptionDocument;
    issueKey: string;
    inlineImages: ParsedInlineImage[];
  }) {
    const uploadedImages = new Map<string, UploadedInlineImage>();
    const imageById = new Map(inlineImages.map((image) => [image.id, image]));
    const uploadFailures: string[] = [];

    for (const inlineImage of inlineImages) {
      try {
        const attachment = await this.uploadIssueAttachment({
          accessToken,
          cloudId,
          issueKey,
          inlineImage,
        });
        uploadedImages.set(inlineImage.id, { attachment, image: inlineImage });
      } catch (error) {
        uploadFailures.push(`${inlineImage.filename}: ${this.formatUnknownError(error)}`);
      }
    }

    if (!uploadedImages.size) {
      return `Issue was created, but no rich text images could be uploaded: ${uploadFailures.join(
        '; ',
      )}`;
    }

    try {
      const inlineDescription = this.replacePendingImageNodes(
        description,
        uploadedImages,
        imageById,
        'media',
      ) as JiraDescriptionDocument;
      const inlineError = await this.updateIssueDescription({
        accessToken,
        cloudId,
        issueKey,
        description: inlineDescription,
      });

      if (!inlineError) {
        return uploadFailures.length
          ? `Some rich text images could not be uploaded: ${uploadFailures.join('; ')}`
          : undefined;
      }

      const linkedDescription = this.replacePendingImageNodes(
        description,
        uploadedImages,
        imageById,
        'link',
      ) as JiraDescriptionDocument;
      const linkError = await this.updateIssueDescription({
        accessToken,
        cloudId,
        issueKey,
        description: linkedDescription,
      });

      if (linkError) {
        return `Images were uploaded as attachments, but Jira rejected inline and linked description updates: ${this.truncate(
          inlineError,
        )}`;
      }

      return 'Images were uploaded as attachments. Jira rejected the inline media blocks, so the description links to the attachments instead.';
    } catch (error) {
      return `Issue was created, but the rich text images could not be placed in the description: ${this.formatUnknownError(
        error,
      )}`;
    }
  }

  private async uploadIssueAttachment({
    accessToken,
    cloudId,
    issueKey,
    inlineImage,
  }: {
    accessToken: string;
    cloudId: string;
    issueKey: string;
    inlineImage: ParsedInlineImage;
  }) {
    const formData = new FormData();
    const imageBytes = new Uint8Array(inlineImage.buffer.byteLength);
    imageBytes.set(inlineImage.buffer);

    formData.append(
      'file',
      new Blob([imageBytes], { type: inlineImage.mimeType }),
      inlineImage.filename,
    );

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(
        issueKey,
      )}/attachments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'X-Atlassian-Token': 'no-check',
        },
        body: formData,
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Jira image upload failed: ${this.truncate(await response.text())}`,
      );
    }

    const attachments = (await response.json()) as UploadedJiraAttachment[];
    const attachment = attachments[0];
    if (!attachment) {
      throw new BadRequestException('Jira image upload did not return an attachment');
    }

    return attachment;
  }

  private async updateIssueDescription({
    accessToken,
    cloudId,
    issueKey,
    description,
  }: {
    accessToken: string;
    cloudId: string;
    issueKey: string;
    description: JiraDescriptionDocument;
  }) {
    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(
        issueKey,
      )}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            description,
          },
        }),
      },
    );

    if (response.ok) {
      return undefined;
    }

    return this.truncate(await response.text());
  }

  private resolveDescriptionDocument(input: CreateJiraIssueInput): JiraDescriptionDocument {
    const descriptionAdfJson = input.descriptionAdfJson?.trim();
    if (!descriptionAdfJson) {
      return this.buildDescriptionDocument(input.description);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(descriptionAdfJson);
    } catch {
      throw new BadRequestException('Rich description ADF is not valid JSON');
    }

    if (
      !this.isRecord(parsed) ||
      parsed.type !== 'doc' ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.content)
    ) {
      throw new BadRequestException('Rich description ADF must be a document');
    }

    return parsed as JiraDescriptionDocument;
  }

  private replacePendingImageNodes(
    node: Record<string, unknown>,
    uploadedImages: Map<string, UploadedInlineImage>,
    imageById: Map<string, ParsedInlineImage>,
    mode: 'placeholder' | 'media' | 'link',
  ): Record<string, unknown> {
    const pendingImageId = this.pendingImageIdFromNode(node);
    if (pendingImageId) {
      const uploaded = uploadedImages.get(pendingImageId);
      const image = uploaded?.image ?? imageById.get(pendingImageId);

      if (uploaded && mode !== 'placeholder') {
        return this.imageNode({
          attachment: uploaded.attachment,
          image: uploaded.image,
          asLink: mode === 'link',
        });
      }

      return this.paragraphFromText(
        image
          ? `[Image: ${image.filename} will be attached after issue creation]`
          : '[Image will be attached after issue creation]',
      );
    }

    const content = node.content;
    if (!Array.isArray(content)) {
      return { ...node };
    }

    return {
      ...node,
      content: content
        .filter((child): child is Record<string, unknown> => this.isRecord(child))
        .map((child) => this.replacePendingImageNodes(child, uploadedImages, imageById, mode)),
    };
  }

  private pendingImageIdFromNode(node: Record<string, unknown>) {
    if (node.type !== 'mediaSingle' || !Array.isArray(node.content)) {
      return undefined;
    }

    const media = node.content.find(
      (child) =>
        this.isRecord(child) &&
        child.type === 'media' &&
        this.isRecord(child.attrs) &&
        child.attrs.collection === 'pending-inline-images' &&
        typeof child.attrs.id === 'string',
    );

    if (!this.isRecord(media) || !this.isRecord(media.attrs)) {
      return undefined;
    }

    return typeof media.attrs.id === 'string' ? media.attrs.id : undefined;
  }

  private buildDescriptionDocument(
    description: string,
    inlineImage?: InlineImageDescription,
  ): JiraDescriptionDocument {
    const content: Array<Record<string, unknown>> = [];
    const lines = description.replace(/\r\n/g, '\n').split('\n');

    for (let index = 0; index < lines.length;) {
      const line = lines[index];
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        index += 1;
        continue;
      }

      const codeFence = trimmedLine.match(/^```([a-z0-9_-]+)?$/i);
      if (codeFence) {
        const codeLines: string[] = [];
        index += 1;

        while (index < lines.length && !lines[index].trim().startsWith('```')) {
          codeLines.push(lines[index]);
          index += 1;
        }

        if (index < lines.length) {
          index += 1;
        }

        const codeBlock: Record<string, unknown> = {
          type: 'codeBlock',
          content: [{ type: 'text', text: codeLines.join('\n') || ' ' }],
        };

        if (codeFence[1]) {
          codeBlock.attrs = { language: codeFence[1] };
        }

        content.push(codeBlock);
        continue;
      }

      const heading = trimmedLine.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        content.push({
          type: 'heading',
          attrs: { level: heading[1].length },
          content: this.parseInlineContent(heading[2]),
        });
        index += 1;
        continue;
      }

      if (/^[-*]\s+/.test(trimmedLine)) {
        const items: Array<Record<string, unknown>> = [];
        while (index < lines.length) {
          const item = lines[index].trim().match(/^[-*]\s+(.+)$/);
          if (!item) {
            break;
          }

          items.push(this.listItemFromText(item[1]));
          index += 1;
        }

        content.push({ type: 'bulletList', content: items });
        continue;
      }

      if (/^\d+\.\s+/.test(trimmedLine)) {
        const items: Array<Record<string, unknown>> = [];
        while (index < lines.length) {
          const item = lines[index].trim().match(/^\d+\.\s+(.+)$/);
          if (!item) {
            break;
          }

          items.push(this.listItemFromText(item[1]));
          index += 1;
        }

        content.push({ type: 'orderedList', content: items });
        continue;
      }

      const blockquote = trimmedLine.match(/^>\s+(.+)$/);
      if (blockquote) {
        const paragraphs: Array<Record<string, unknown>> = [];
        while (index < lines.length) {
          const quoteLine = lines[index].trim().match(/^>\s+(.+)$/);
          if (!quoteLine) {
            break;
          }

          paragraphs.push(this.paragraphFromText(quoteLine[1]));
          index += 1;
        }

        content.push({ type: 'blockquote', content: paragraphs });
        continue;
      }

      const paragraphLines = [trimmedLine];
      index += 1;

      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^```/.test(lines[index].trim()) &&
        !/^(#{1,3})\s+/.test(lines[index].trim()) &&
        !/^[-*]\s+/.test(lines[index].trim()) &&
        !/^\d+\.\s+/.test(lines[index].trim()) &&
        !/^>\s+/.test(lines[index].trim())
      ) {
        paragraphLines.push(lines[index].trim());
        index += 1;
      }

      content.push(this.paragraphFromText(paragraphLines.join(' ')));
    }

    if (inlineImage) {
      content.push(this.imageNode(inlineImage));
    }

    if (!content.length) {
      content.push(this.paragraphFromText(' '));
    }

    return {
      type: 'doc',
      version: 1,
      content,
    };
  }

  private imageNode({ attachment, image, asLink }: InlineImageDescription) {
    if (asLink) {
      const href = attachment.content ?? attachment.thumbnail;
      return {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: attachment.filename,
            marks: href ? [{ type: 'link', attrs: { href } }] : [{ type: 'strong' }],
          },
        ],
      };
    }

    return {
      type: 'mediaSingle',
      attrs: {
        layout: 'center',
      },
      content: [
        {
          type: 'media',
          attrs: {
            id: attachment.id,
            type: 'file',
            collection: 'jira-issue-attachments',
            alt: attachment.filename,
            width: image.width ?? 640,
            height: image.height ?? 360,
          },
        },
      ],
    };
  }

  private listItemFromText(text: string) {
    return {
      type: 'listItem',
      content: [this.paragraphFromText(text)],
    };
  }

  private paragraphFromText(text: string) {
    return {
      type: 'paragraph',
      content: this.parseInlineContent(text),
    };
  }

  private parseInlineContent(text: string) {
    const nodes: Array<Record<string, unknown>> = [];
    const inlinePattern =
      /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    const pushText = (value: string, marks?: Array<Record<string, unknown>>) => {
      if (!value) {
        return;
      }

      nodes.push({
        type: 'text',
        text: value,
        ...(marks?.length ? { marks } : {}),
      });
    };

    while ((match = inlinePattern.exec(text))) {
      pushText(text.slice(cursor, match.index));

      if (match[2] && match[3]) {
        pushText(match[2], [{ type: 'link', attrs: { href: match[3] } }]);
      } else if (match[4]) {
        pushText(match[4], [{ type: 'strong' }]);
      } else if (match[5]) {
        pushText(match[5], [{ type: 'code' }]);
      } else if (match[6]) {
        pushText(match[6], [{ type: 'em' }]);
      }

      cursor = match.index + match[0].length;
    }

    pushText(text.slice(cursor));

    return nodes.length ? nodes : [{ type: 'text', text: ' ' }];
  }

  private sanitizeFilename(filename?: string) {
    const sanitized = filename?.replace(/[/\\?%*:|"<>]/g, '-').trim();
    return sanitized || undefined;
  }

  private extensionForMimeType(mimeType: string) {
    if (mimeType === 'image/jpeg') {
      return 'jpg';
    }

    const subtype = mimeType.split('/')[1]?.replace(/[^a-z0-9]/g, '');
    return subtype || 'png';
  }

  private formatUnknownError(error: unknown) {
    if (error instanceof Error) {
      return this.truncate(error.message);
    }

    return this.truncate(String(error));
  }

  private truncate(value: string, maxLength = 800) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
