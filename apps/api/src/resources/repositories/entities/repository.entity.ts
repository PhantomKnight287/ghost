import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class RepositoryParentEntity {
  @ApiProperty()
  @IsString()
  username: string;

  @ApiProperty()
  @IsString()
  slug: string;

  @ApiProperty()
  @IsString()
  name: string;
}

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

  @ApiProperty()
  @IsInt()
  starCount: number;

  @ApiProperty()
  @IsBoolean()
  viewerHasStarred: boolean;

  @ApiProperty()
  @IsInt()
  forkCount: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Slug of the viewer's own fork of this repository, if any",
  })
  @IsString()
  @IsOptional()
  viewerForkSlug: string | null;

  @ApiPropertyOptional({
    type: RepositoryParentEntity,
    nullable: true,
    description: 'The repository this one was forked from',
  })
  @IsOptional()
  parent: RepositoryParentEntity | null;
}
