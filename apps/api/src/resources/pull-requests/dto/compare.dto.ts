import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { PullRequestFileDTO } from './pull-request-changes.dto.js';

export class CompareQueryDTO {
  @ApiProperty({ description: 'Branch the changes would merge into.' })
  @IsString()
  @MaxLength(255)
  base: string;

  @ApiProperty({
    description: 'Branch the changes come from, `owner:branch` for a fork.',
  })
  @IsString()
  @MaxLength(511)
  head: string;
}

export class ComparePatchQueryDTO extends CompareQueryDTO {
  @ApiPropertyOptional({ description: 'Limit the patch to one path.' })
  @IsString()
  @IsOptional()
  @MaxLength(4096)
  path?: string;
}

export class CompareResponseDTO {
  @ApiProperty({ description: 'Merge base of the two branches.' })
  @IsString()
  from: string;

  @ApiProperty({ description: 'Head tip the diff is taken to.' })
  @IsString()
  to: string;

  @ApiProperty({ type: [PullRequestFileDTO] })
  @ValidateNested({ each: true })
  @Type(() => PullRequestFileDTO)
  files: PullRequestFileDTO[];
}
