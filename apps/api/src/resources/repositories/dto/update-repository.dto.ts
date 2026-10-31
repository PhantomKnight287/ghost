import { schema } from '@ghost/db';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

export class UpdateRepositoryRequestDTO {
  @ApiPropertyOptional({
    description:
      'Renaming also changes the slug, so the old URL stops resolving.',
  })
  @IsString()
  @IsNotEmpty()
  @ValidateIf((_, value) => value !== undefined)
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  @IsIn(schema.repositoryVisiblity.enumValues)
  @ValidateIf((_, value) => value !== undefined)
  visibility?: (typeof schema.repositoryVisiblity.enumValues)[number];

  @ApiPropertyOptional({
    description:
      'A branch name without `refs/heads/`. The branch must already exist.',
  })
  @IsString()
  @IsNotEmpty()
  @ValidateIf((_, value) => value !== undefined)
  defaultBranch?: string;
}
