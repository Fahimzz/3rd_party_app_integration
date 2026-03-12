import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GithubRepoDto {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  fullName!: string;

  @Field()
  ownerLogin!: string;

  @Field()
  htmlUrl!: string;

  @Field()
  private!: boolean;
}

