import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class RepositoryEntity {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty()
  @IsString()
  slug: string;

  @ApiProperty({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  @IsString()
  visibility: (typeof schema.repositoryVisiblity.enumValues)[number];

  @ApiProperty()
  @IsISO8601()
  lastPushedAt: string;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;
}
