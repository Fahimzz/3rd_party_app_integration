import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ConnectJiraPayloadDto {
  @Field()
  authorizationUrl!: string;

  @Field()
  state!: string;
}
