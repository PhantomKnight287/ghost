import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class GetRepositoryBranchesResponseDTO {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Branch the repository opens on. `null` when nothing has been pushed yet.',
    example: 'main',
  })
  @IsString()
  @IsOptional()
  defaultBranch: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Branch names, without the `refs/heads/` prefix, ordered by name.',
    example: ['main', 'feat/contents'],
  })
  @IsArray()
  @IsString({ each: true })
  branches: string[];
}
