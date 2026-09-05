import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { RepositoryEntity } from '../entities/repository.entity.js';

export class GetRepositoriesQueryDTO {
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
    default: 20,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class GetRepositoriesResponseDTO {
  @ApiProperty({ type: [RepositoryEntity] })
  repositories: RepositoryEntity[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Pass back as `cursor` for the next page. `null` on the last page.',
  })
  @IsString()
  @IsOptional()
  nextCursor: string | null;

  @ApiProperty()
  @IsBoolean()
  hasMore: boolean;
}
