import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class GetRepositoryReadmeQueryDTO {
  @ApiPropertyOptional({
    description:
      'Branch, tag-free ref or commit sha to read from. Accepts `main`, ' +
      '`refs/heads/main` or a commit sha. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;
}

export class GetRepositoryReadmeResponseDTO {
  @ApiProperty({
    description: 'Ref that was read, always fully qualified.',
    example: 'refs/heads/main',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Path of the README that was found, `null` when the repository has none.',
    example: 'README.md',
  })
  @IsString()
  @IsOptional()
  path: string | null;

  @ApiProperty({ description: 'README size in bytes, 0 when there is none.' })
  @IsInt()
  size: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Markdown source. `null` when there is no README, when it is past the ' +
      'inline size limit, or when it is not valid UTF-8 text.',
  })
  @IsString()
  @IsOptional()
  content: string | null;
}
