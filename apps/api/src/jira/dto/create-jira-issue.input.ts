import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

@InputType()
export class JiraInlineImageInput {
  @Field()
  @IsString()
  @MaxLength(80)
  id!: string;

  @Field()
  @IsString()
  @MaxLength(7_000_000)
  dataUrl!: string;

  @Field()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  filename!: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  width?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  height?: number;
}

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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  descriptionAdfJson?: string;

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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(7_000_000)
  inlineImageDataUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  inlineImageFilename?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  inlineImageWidth?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  inlineImageHeight?: number;

  @Field(() => [JiraInlineImageInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JiraInlineImageInput)
  inlineImages?: JiraInlineImageInput[];
}
