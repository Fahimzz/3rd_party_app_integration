import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class JiraTicketDto {
  @Field(() => ID)
  id!: string;

  @Field()
  jiraIssueId!: string;

  @Field()
  jiraKey!: string;

  @Field()
  summary!: string;

  @Field()
  projectKey!: string;

  @Field()
  createdAt!: Date;
}
