import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUserEntity } from '../auth/entities/auth-user.entity';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CompleteJiraConnectionInput } from './dto/complete-jira-connection.input';
import { ConnectJiraPayloadDto } from './dto/connect-jira-payload.dto';
import { CreateJiraIssueInput } from './dto/create-jira-issue.input';
import { JiraAssigneeDto } from './dto/jira-assignee.dto';
import { JiraConnectionDto } from './dto/jira-connection.dto';
import { JiraProjectDto } from './dto/jira-project.dto';
import { JiraTicketDto } from './dto/jira-ticket.dto';
import { JiraService } from './jira.service';

@Resolver()
@UseGuards(GqlAuthGuard)
export class JiraResolver {
  constructor(private readonly jiraService: JiraService) {}

  @Query(() => JiraConnectionDto)
  jiraConnection(@CurrentUser() user: AuthUserEntity) {
    return this.jiraService.getConnection(user.id);
  }

  @Query(() => [JiraTicketDto])
  myTickets(@CurrentUser() user: AuthUserEntity) {
    return this.jiraService.listTickets(user.id);
  }

  @Query(() => [JiraProjectDto])
  jiraProjects(@CurrentUser() user: AuthUserEntity) {
    return this.jiraService.listProjects(user.id);
  }

  @Query(() => [JiraAssigneeDto])
  jiraAssignableUsers(
    @CurrentUser() user: AuthUserEntity,
    @Args('projectKey', { type: () => String, nullable: true }) projectKey?: string,
  ) {
    return this.jiraService.listAssignableUsers(user.id, projectKey);
  }

  @Mutation(() => ConnectJiraPayloadDto)
  beginJiraConnection(@CurrentUser() user: AuthUserEntity) {
    return this.jiraService.createConnectUrl(user.id);
  }

  @Mutation(() => JiraConnectionDto)
  completeJiraConnection(
    @CurrentUser() user: AuthUserEntity,
    @Args('input') input: CompleteJiraConnectionInput,
  ) {
    return this.jiraService.completeConnection(user.id, input);
  }

  @Mutation(() => JiraTicketDto)
  createJiraIssue(@CurrentUser() user: AuthUserEntity, @Args('input') input: CreateJiraIssueInput) {
    return this.jiraService.createIssue(user.id, input);
  }
}
