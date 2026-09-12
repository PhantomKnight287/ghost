import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateIssueRequestDTO {
  @ApiProperty({ example: 'Login fails with 500 on Safari' })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: 'Markdown.' })
  @IsString()
  @IsOptional()
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional({
    description: 'Label names in this repository.',
    example: ['bug'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  @IsOptional()
  labels?: string[];

  @ApiPropertyOptional({
    description: 'Usernames to assign.',
    example: ['octocat'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  assignees?: string[];
}

export class UpdateIssueRequestDTO {
  @ApiPropertyOptional({ example: 'Login fails with 500 on Safari' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Markdown. `null` clears the description.',
  })
  @IsString()
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @MaxLength(20000)
  body?: string | null;
}
