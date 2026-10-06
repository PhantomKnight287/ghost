import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, ValidateNested } from 'class-validator';

export class ForkStorageUsageDTO {
  @ApiProperty({ description: 'Bytes stored in forks.' })
  @IsInt()
  usedBytes: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` when no fork quota applies.',
  })
  @IsInt()
  @IsOptional()
  quotaBytes: number | null;
}

export class StorageUsageDTO {
  @ApiProperty({
    description: 'Bytes stored outside forks, including uploads in progress.',
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

  @ApiProperty({ type: ForkStorageUsageDTO })
  @ValidateNested()
  @Type(() => ForkStorageUsageDTO)
  fork: ForkStorageUsageDTO;
}
