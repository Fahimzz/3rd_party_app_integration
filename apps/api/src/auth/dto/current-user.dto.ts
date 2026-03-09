import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CurrentUserDto {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;
}
