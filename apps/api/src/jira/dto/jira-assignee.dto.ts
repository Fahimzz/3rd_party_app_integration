import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class JiraAssigneeDto {
  @Field()
  accountId!: string;

  @Field()
  displayName!: string;

  @Field()
  active!: boolean;
}
