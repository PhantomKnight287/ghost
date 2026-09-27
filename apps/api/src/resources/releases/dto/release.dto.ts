import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ReleaseAssetDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'ghost-linux-x64.tar.gz' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'application/gzip' })
  @IsString()
  contentType: string;

  @ApiProperty({ description: 'Bytes.' })
  @IsInt()
  size: number;

  @ApiProperty()
  @IsInt()
  downloadCount: number;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;
}

export class UploadReleaseAssetQueryDTO {
  @ApiProperty({
    description: 'File name the asset is saved and downloaded under.',
    example: 'ghost-linux-x64.tar.gz',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    description:
      'Media type the file is served with. The request body itself is always `application/octet-stream`.',
    example: 'application/gzip',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/)
  type?: string;
}

export class ReleaseDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    description: 'Tag name, without the `refs/tags/` prefix.',
    example: 'v1.0.0',
  })
  @IsString()
  tagName: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '`null` reads as the tag name.',
  })
  @IsString()
  @IsOptional()
  name: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Markdown.' })
  @IsString()
  @IsOptional()
  body: string | null;

  @ApiProperty({
    description: 'Only people who can write to the repository see drafts.',
  })
  @IsBoolean()
  isDraft: boolean;

  @ApiProperty()
  @IsBoolean()
  isPrerelease: boolean;

  @ApiProperty({
    description:
      'The most recently published release that is neither a draft nor a prerelease.',
  })
  @IsBoolean()
  isLatest: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null once the author account is deleted.',
  })
  @IsString()
  @IsOptional()
  authorUsername: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The commit the tag points at. `null` when the tag has since been deleted.',
  })
  @IsString()
  @IsOptional()
  commitSha: string | null;

  @ApiProperty({ type: [ReleaseAssetDTO], description: 'By name.' })
  @ValidateNested({ each: true })
  @Type(() => ReleaseAssetDTO)
  assets: ReleaseAssetDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsISO8601()
  @IsOptional()
  publishedAt: string | null;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;

  @ApiProperty({
    description: 'True when the requesting user can write to the repository.',
  })
  @IsBoolean()
  viewerCanEdit: boolean;
}

export class GetReleasesQueryDTO {
  @ApiPropertyOptional({
    description:
      'Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page.',
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size.',
    minimum: 1,
    maximum: 100,
    default: 10,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class GetReleasesResponseDTO {
  @ApiProperty({ type: [ReleaseDTO], description: 'Newest first.' })
  @ValidateNested({ each: true })
  @Type(() => ReleaseDTO)
  releases: ReleaseDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}

export class CreateReleaseRequestDTO {
  @ApiProperty({
    description:
      'An existing tag, or a new one to create at `target`. Without the `refs/tags/` prefix.',
    example: 'v1.0.0',
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(250)
  tagName: string;

  @ApiPropertyOptional({
    description:
      'Branch or commit sha a new tag points at. Defaults to the default branch; ignored when the tag already exists.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  @MaxLength(250)
  target?: string;

  @ApiPropertyOptional({ example: 'First stable release' })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Markdown.' })
  @IsString()
  @IsOptional()
  @MaxLength(100000)
  body?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isDraft?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isPrerelease?: boolean;
}

export class UpdateReleaseRequestDTO {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '`null` falls back to the tag name.',
  })
  @IsString()
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(200)
  name?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Markdown. `null` clears the notes.',
  })
  @IsString()
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @MaxLength(100000)
  body?: string | null;

  @ApiPropertyOptional({
    description: 'Publishing a draft stamps `publishedAt` the first time.',
  })
  @IsBoolean()
  @IsOptional()
  isDraft?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrerelease?: boolean;
}
