import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class RepositorySearchResultDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'octocat' })
  @IsString()
  owner: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  slug: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  lastPushedAt: Date;
}

export class SearchRepositoriesResponseDTO {
  @ApiProperty({ type: [RepositorySearchResultDTO] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepositorySearchResultDTO)
  repositories: RepositorySearchResultDTO[];

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
