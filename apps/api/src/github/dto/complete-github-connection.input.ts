import { Field, InputType } from '@nestjs/graphql';
import { IsString } from 'class-validator';

@InputType()
export class CompleteGithubConnectionInput {
  @Field()
  @IsString()
  code!: string;

  @Field()
  @IsString()
  state!: string;
}

