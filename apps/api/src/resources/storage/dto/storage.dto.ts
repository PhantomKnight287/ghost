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
      'Bytes stored in repositories that are not forks, including uploads in progress and leaving out Git LFS objects.',
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
    description: 'Everything forks hold, Git LFS objects included.',
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
}
