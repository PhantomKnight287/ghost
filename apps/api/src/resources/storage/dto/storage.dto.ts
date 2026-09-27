import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

export class StorageUsageDTO {
  @ApiProperty({ description: 'Bytes stored, including uploads in progress.' })
  @IsInt()
  usedBytes: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` when this instance sets no quota.',
  })
  @IsInt()
  @IsOptional()
  quotaBytes: number | null;

  @ApiProperty({ description: 'Largest single release asset.' })
  @IsInt()
  maxAssetBytes: number;
}
