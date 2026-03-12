import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUserEntity } from '../auth/entities/auth-user.entity';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { CompleteGithubConnectionInput } from './dto/complete-github-connection.input';
import { ConnectGithubPayloadDto } from './dto/connect-github-payload.dto';
import { CreateGithubIssueInput } from './dto/create-github-issue.input';
import { GithubConnectionDto } from './dto/github-connection.dto';
import { GithubIssueDto } from './dto/github-issue.dto';
import { GithubRepoDto } from './dto/github-repo.dto';
import { GithubService } from './github.service';

@Resolver()
@UseGuards(GqlAuthGuard)
export class GithubResolver {
  constructor(private readonly githubService: GithubService) {}

  @Query(() => GithubConnectionDto)
  githubConnection(@CurrentUser() user: AuthUserEntity) {
    return this.githubService.getConnection(user.id);
  }

  @Query(() => [GithubRepoDto])
  githubRepos(@CurrentUser() user: AuthUserEntity) {
    return this.githubService.listRepos(user.id);
  }

  @Mutation(() => ConnectGithubPayloadDto)
  beginGithubConnection(@CurrentUser() user: AuthUserEntity) {
    return this.githubService.createConnectUrl(user.id);
  }

  @Mutation(() => GithubConnectionDto)
  completeGithubConnection(
    @CurrentUser() user: AuthUserEntity,
    @Args('input') input: CompleteGithubConnectionInput,
  ) {
    return this.githubService.completeConnection(user.id, input);
  }

  @Mutation(() => GithubIssueDto)
  createGithubIssue(
    @CurrentUser() user: AuthUserEntity,
    @Args('input') input: CreateGithubIssueInput,
  ) {
    return this.githubService.createIssue(user.id, input);
  }
}

