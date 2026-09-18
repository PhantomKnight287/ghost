import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GetRepositoryForksQueryDTO {
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

export class ForkDTO {
  @ApiProperty({ description: 'Owner of the fork.' })
  @IsString()
  username: string;

  @ApiProperty()
  @IsString()
  slug: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  description: string | null;

  @ApiProperty()
  @IsISO8601()
  lastPushedAt: string;
}

export class GetRepositoryForksResponseDTO {
  @ApiProperty({ type: [ForkDTO] })
  forks: ForkDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;

  @ApiProperty()
  @IsBoolean()
  hasMore: boolean;
}
