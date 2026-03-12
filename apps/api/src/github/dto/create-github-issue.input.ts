import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, Matches, MinLength } from 'class-validator';

@InputType()
export class CreateGithubIssueInput {
  @Field()
  @IsString()
  @MinLength(3)
  @Matches(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, {
    message: 'repoFullName must be in the form owner/repo',
  })
  repoFullName!: string;

  @Field()
  @IsString()
  @MinLength(3)
  title!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  body?: string;

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

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
          .map((assignee) => (typeof assignee === 'string' ? assignee.trim() : assignee))
          .filter(Boolean)
      : value,
  )
  assignees?: string[];
}

