import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ConnectGithubPayloadDto {
  @Field()
  authorizationUrl!: string;

  @Field()
  state!: string;
}

