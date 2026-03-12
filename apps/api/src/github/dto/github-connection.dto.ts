import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class GithubConnectionDto {
  @Field()
  connected!: boolean;

  @Field(() => String, { nullable: true })
  login?: string | null;
}

