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
const NAME = {
  example: 'bug',
  minLength: 1,
  maxLength: 50,
  description:
    'Up to 50 characters, counted in code points. A name with leading or trailing whitespace, or one that is `.` or `..`, is refused with 422 `invalid`. Names are unique in a repository ignoring case: one that differs from another label only by case is refused with 422 `already_exists`.',
};
const COLOR = {
  example: 'd73a4a',
  pattern: '^#?[0-9a-fA-F]{6}$',
  description:
    'Six hex digits, with or without a leading `#`. Stored and returned lowercase without the `#`: `#FF00AA` reads back as `ff00aa`.',
};

export class GithubCreateLabelDTO {
  @ApiProperty(NAME)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ ...COLOR, default: 'ededed' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/^#/, '') : value,
  )
  color?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string;
}

export class GithubUpdateLabelDTO {
  @ApiPropertyOptional(NAME)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  new_name?: string;

  @ApiPropertyOptional(COLOR)
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/^#/, '') : value,
  )
  color?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string | null;
}

export class GithubLabelDTO {
  @ApiProperty({ type: Number, nullable: true })
  id: number | null;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ description: 'The label by name, percent-encoded.' })
  url: string;

  @ApiProperty({
    example: 'bug',
    description: 'As stored, whatever case a lookup used.',
  })
  name: string;

  @ApiProperty({
    example: 'd73a4a',
    description: 'Six lowercase hex digits, no `#`.',
  })
  color: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ example: false })
  default: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Always null: Ghost does not archive labels.',
  })
  archived_at: null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: 'Always null: Ghost does not archive labels.',
  })
  archived_by: null;
}
