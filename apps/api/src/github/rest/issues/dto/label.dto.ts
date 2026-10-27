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
export class GithubCreateLabelDTO {
  @ApiProperty({ example: 'bug' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: 'd73a4a', default: 'ededed' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/^#/, '') : value,
  )
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
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  new_name?: string;

  @ApiPropertyOptional({ example: 'd73a4a' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/^#/, '') : value,
  )
  color?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string | null;
}
