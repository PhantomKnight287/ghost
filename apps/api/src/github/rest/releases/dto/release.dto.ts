import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';

const MAKE_LATEST = ['true', 'false', 'legacy'] as const;

/** GitHub's create-release body. */
export class GithubCreateReleaseDTO {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(250)
  tag_name: string;

  @ApiPropertyOptional({
    description:
      'Branch or commit SHA a new tag is created from. Defaults to the default branch; unused when the tag already exists.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  target_commitish?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  body?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  prerelease?: boolean;

  @ApiPropertyOptional({
    description:
      'Ghost has no discussions, so any category is one that does not exist: 404, as GitHub answers an unknown category.',
  })
  @IsOptional()
  @IsString()
  discussion_category_name?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Ghost cannot generate notes; `true` is refused with 422.',
  })
  @IsOptional()
  @IsBoolean()
  generate_release_notes?: boolean;

  @ApiPropertyOptional({
    enum: MAKE_LATEST,
    default: 'true',
    description:
      'Accepted and ignored: Ghost computes the latest release as the newest published one that is not a prerelease.',
  })
  @IsOptional()
  @IsIn(MAKE_LATEST)
  make_latest?: (typeof MAKE_LATEST)[number];
}

/** GitHub's update-release body. */
export class GithubUpdateReleaseDTO {
  @ApiPropertyOptional({
    description: 'Moving a release to another tag is refused with 422.',
  })
  @IsOptional()
  @IsString()
  tag_name?: string;

  @ApiPropertyOptional({ description: 'Unused: the tag already exists.' })
  @IsOptional()
  @IsString()
  target_commitish?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100000)
  body?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  prerelease?: boolean;

  @ApiPropertyOptional({
    enum: MAKE_LATEST,
    description: 'Accepted and ignored, as on create.',
  })
  @IsOptional()
  @IsIn(MAKE_LATEST)
  make_latest?: (typeof MAKE_LATEST)[number];

  @ApiPropertyOptional({ description: 'Refused with 404, as on create.' })
  @IsOptional()
  @IsString()
  discussion_category_name?: string;
}

/** GitHub's upload query: the asset's file name and an optional label. */
export class GithubUploadReleaseAssetQueryDTO {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}

/** GitHub's update-release-asset body. `state` is undocumented and dropped by the whitelist. */
export class GithubUpdateReleaseAssetDTO {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'An empty label clears it.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}

export class GithubReleaseAssetDTO {
  @ApiProperty()
  url: string;

  @ApiProperty()
  browser_download_url: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  label: string | null;

  @ApiProperty({
    example: 'uploaded',
    description: 'Assets still uploading are never listed.',
  })
  state: string;

  @ApiProperty()
  content_type: string;

  @ApiProperty()
  size: number;

  @ApiProperty({ type: String, nullable: true })
  digest: null;

  @ApiProperty()
  download_count: number;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  uploader: GithubSimpleUserDTO | null;
}

export class GithubReleaseDTO {
  @ApiProperty()
  url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  assets_url: string;

  @ApiProperty({ description: 'A URI template taking `name` and `label`.' })
  upload_url: string;

  @ApiProperty()
  tarball_url: string;

  @ApiProperty()
  zipball_url: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ example: 'v1.0.0' })
  tag_name: string;

  @ApiProperty({
    description:
      'The commit the tag points at, or the default branch once the tag is deleted. Ghost does not keep the branch a release was cut from.',
  })
  target_commitish: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty({ type: String, nullable: true })
  body: string | null;

  @ApiProperty()
  draft: boolean;

  @ApiProperty()
  prerelease: boolean;

  @ApiProperty({ example: false })
  immutable: boolean;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  published_at: string | null;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ type: GithubSimpleUserDTO, nullable: true })
  author: GithubSimpleUserDTO | null;

  @ApiProperty({ type: [GithubReleaseAssetDTO] })
  assets: GithubReleaseAssetDTO[];
}
