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
