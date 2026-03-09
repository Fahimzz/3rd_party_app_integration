import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AuthResponseDto {
  @Field()
  accessToken!: string;
}
