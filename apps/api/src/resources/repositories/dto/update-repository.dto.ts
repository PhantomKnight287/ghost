import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { schema } from '@ghost/db';

export class UpdateRepositoryRequestDTO {
  @ApiPropertyOptional({
    description:
      'Renaming also changes the slug, so the old URL stops resolving.',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
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
  @IsOptional()
  visibility?: (typeof schema.repositoryVisiblity.enumValues)[number];

  @ApiPropertyOptional({
    description:
      'A branch name without `refs/heads/`. The branch must already exist.',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  defaultBranch?: string;
}
