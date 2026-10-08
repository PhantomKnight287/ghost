import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class GetRepositoryPathsQueryDTO {
  @ApiPropertyOptional({
    description:
      'Branch, tag or commit sha to list. Accepts `main`, `refs/heads/main` or a commit sha. Omit for the default branch.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  ref?: string;
}

export class GetRepositoryPathsResponseDTO {
  @ApiProperty({
    description: 'Ref that was listed, always fully qualified.',
    example: 'refs/heads/main',
  })
  @IsString()
  ref: string;

  @ApiProperty({
    type: [String],
    description:
      'Every file at the ref, from the repository root, in byte order. Submodules are left out. Empty for an unborn ref.',
    example: ['README.md', 'src/main.ts'],
  })
  @IsString({ each: true })
  paths: string[];
}
