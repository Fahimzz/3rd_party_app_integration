import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class JiraProjectDto {
  @Field()
  id!: string;

  @Field()
  key!: string;

  @Field()
  name!: string;
}
