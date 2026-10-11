import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const HEX_COLOR = /^[0-9a-fA-F]{6}$/;
const withoutHash = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/^#/, '') : value;

export class GithubCreateLabelDTO {
  @ApiProperty({ example: 'bug' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: 'd73a4a', default: 'ededed' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR)
  @Transform(withoutHash)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string;
}

export class GithubUpdateLabelDTO {
  @ApiPropertyOptional({ example: 'bug' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  new_name?: string;

  @ApiPropertyOptional({ example: 'd73a4a' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR)
  @Transform(withoutHash)
  color?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string | null;
}
