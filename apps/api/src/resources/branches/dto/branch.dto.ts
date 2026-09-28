import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBranchRequestDTO {
  @ApiProperty({
    description: 'Name of the new branch, without the `refs/heads/` prefix.',
    example: 'feat/branches',
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(250)
  name: string;

  @ApiPropertyOptional({
    description:
      'Branch, tag or commit sha the new branch starts at. Defaults to the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  @MaxLength(250)
  from?: string;
}

export class BranchDTO {
  @ApiProperty({ example: 'feat/branches' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'The commit the branch points at.' })
  @IsString()
  sha: string;
}
