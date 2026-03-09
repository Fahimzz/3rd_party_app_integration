import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, Matches, MinLength } from 'class-validator';

@InputType()
export class CreateJiraIssueInput {
  @Field()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @MinLength(2)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message:
      'projectKey must be a Jira project key (uppercase letters/numbers/underscore), e.g. TEST',
  })
  projectKey!: string;

  @Field()
  @IsString()
  @MinLength(3)
  summary!: string;

  @Field()
  @IsString()
  @MinLength(3)
  description!: string;

  @Field()
  @IsString()
  issueType!: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((label) => (typeof label === 'string' ? label.trim() : label)).filter(Boolean)
      : value,
  )
  labels?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  priority?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  assigneeAccountId?: string;
}
