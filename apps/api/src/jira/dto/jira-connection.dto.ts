import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class JiraConnectionDto {
  @Field()
  connected!: boolean;

  @Field(() => String, { nullable: true })
  siteName?: string | null;
}
