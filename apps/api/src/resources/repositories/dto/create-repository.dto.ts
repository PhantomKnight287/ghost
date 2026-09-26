import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { schema } from '@ghost/db';

export class CreateRepositoryRequestDTO {
  @ApiProperty({})
  @IsString()
  name: string;

  @ApiPropertyOptional({})
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      "Slug of the organization to create the repository in; the requester's own account when omitted. Needs admin in the organization.",
  })
  @IsString()
  @IsOptional()
  organization?: string;

  @ApiPropertyOptional({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  @IsIn(schema.repositoryVisiblity.enumValues)
  @IsOptional()
  visibility?: (typeof schema.repositoryVisiblity.enumValues)[number];
}

export class CreateRepositoryResponseDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  slug: string;
}
