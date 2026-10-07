import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, ValidateNested } from 'class-validator';

export class StorageLimitUsageDTO {
  @ApiProperty({ description: 'Bytes counted against this limit.' })
  @IsInt()
  usedBytes: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` when no quota applies.',
  })
  @IsInt()
  @IsOptional()
  quotaBytes: number | null;
}

export class StorageUsageDTO {
  @ApiProperty({
    description:
      "Bytes of pushed git data and merged pull requests' heads in repositories that are not forks, leaving out Git LFS objects, release assets and attachments.",
  })
  @IsInt()
  usedBytes: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` when no quota applies.',
  })
  @IsInt()
  @IsOptional()
  quotaBytes: number | null;

  @ApiProperty({ description: 'Largest single release asset.' })
  @IsInt()
  maxAssetBytes: number;

  @ApiProperty({
    type: StorageLimitUsageDTO,
    description:
      'Everything forks hold, Git LFS objects and release assets included.',
  })
  @ValidateNested()
  @Type(() => StorageLimitUsageDTO)
  fork: StorageLimitUsageDTO;

  @ApiProperty({
    type: StorageLimitUsageDTO,
    description: 'Git LFS objects in repositories that are not forks.',
  })
  @ValidateNested()
  @Type(() => StorageLimitUsageDTO)
  lfs: StorageLimitUsageDTO;

  @ApiProperty({
    type: StorageLimitUsageDTO,
    description:
      'Release assets in repositories that are not forks, and for a user, files they attached to issues, pull requests and comments anywhere. Includes uploads in progress.',
  })
  @ValidateNested()
  @Type(() => StorageLimitUsageDTO)
  asset: StorageLimitUsageDTO;
}
