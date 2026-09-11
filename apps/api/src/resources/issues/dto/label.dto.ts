import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LabelDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'bug' })
  @IsString()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  description: string | null;

  @ApiProperty({
    description: '6 hex chars, no `#`. The client adds `#` when rendering.',
    example: 'd73a4a',
  })
  @IsString()
  color: string;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;
}

export class CreateLabelRequestDTO {
  @ApiProperty({ example: 'bug' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ example: 'Something is not working' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  description?: string;

  @ApiProperty({ example: 'd73a4a' })
  @IsString()
  @Matches(/^[0-9a-fA-F]{6}$/, {
    message: 'Color must be 6 hex characters, e.g. d73a4a.',
  })
  color: string;
}

export class UpdateLabelRequestDTO {
  @ApiPropertyOptional({ example: 'bug' })
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '`null` clears the description.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  description?: string | null;

  @ApiPropertyOptional({ example: 'd73a4a' })
  @IsString()
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{6}$/, {
    message: 'Color must be 6 hex characters, e.g. d73a4a.',
  })
  color?: string;
}

export class GetLabelsResponseDTO {
  @ApiProperty({ type: [LabelDTO] })
  @ValidateNested({ each: true })
  @Type(() => LabelDTO)
  labels: LabelDTO[];
}

export class SetIssueLabelsRequestDTO {
  @ApiProperty({
    description: 'Full replacement set. Label names in this repository.',
    example: ['bug', 'help wanted'],
  })
  @IsString({ each: true })
  names: string[];
}

export class SetIssueAssigneesRequestDTO {
  @ApiProperty({
    description: 'Full replacement set. Usernames to assign.',
    example: ['octocat'],
  })
  @IsString({ each: true })
  usernames: string[];
}
