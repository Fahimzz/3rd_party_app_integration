import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GithubIssueDto {
  @Field()
  id!: string;

  @Field(() => Int)
  number!: number;

  @Field()
  url!: string;

  @Field()
  title!: string;
}

