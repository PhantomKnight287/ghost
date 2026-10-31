import { schema } from '@ghost/db';
import { type Role, roleHierarchy } from '@ghost/permissions';
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
    description:
      'The owner it lives under now; differs from the requested one after a rename or transfer.',
  })
  @IsString()
  owner: string;

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

  @ApiProperty({
    enumName: 'ViewerRole',
    enum: roleHierarchy,
    nullable: true,
    description:
      "The viewer's role here: `owner`, a collaborator role, or null for anyone else.",
  })
  @IsString()
  @IsOptional()
  viewerRole: Role | null;

  @ApiPropertyOptional({
    type: RepositoryParentEntity,
    nullable: true,
    description: 'The repository this one was forked from',
  })
  @IsOptional()
  parent: RepositoryParentEntity | null;
}
