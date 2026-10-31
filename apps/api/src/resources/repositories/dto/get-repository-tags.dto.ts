import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class GetRepositoryTagsQueryDTO {
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

export class TagDTO {
  @ApiProperty({
    description: 'Tag name, without the `refs/tags/` prefix.',
    example: 'v1.0.0',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'The commit the tag points at, through any annotation.',
  })
  @IsString()
  sha: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The annotation's subject; `null` for a lightweight tag.",
  })
  @IsString()
  @IsOptional()
  message: string | null;

  @ApiProperty({
    description:
      'When the annotation was made, or for a lightweight tag when its commit was.',
  })
  @IsISO8601()
  createdAt: string;
}

export class GetRepositoryTagsResponseDTO {
  @ApiProperty({ type: [TagDTO], description: 'Newest first.' })
  @ValidateNested({ each: true })
  @Type(() => TagDTO)
  tags: TagDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}
