import { Field, InputType } from '@nestjs/graphql';
import { IsString } from 'class-validator';

@InputType()
export class CompleteJiraConnectionInput {
  @Field()
  @IsString()
  code!: string;

  @Field()
  @IsString()
  state!: string;
}
