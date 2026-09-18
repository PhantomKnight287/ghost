import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetRepositoryContributorsQueryDTO {
  @ApiPropertyOptional({
    description:
      'Branch or commit sha to walk. Defaults to the repository default branch.',
  })
  @IsString()
  @IsOptional()
  ref?: string;

  @ApiPropertyOptional({
    description: 'Maximum contributors to return.',
    minimum: 1,
    maximum: 100,
    default: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class ContributorDTO {
  @ApiProperty({
    description:
      'Linked Ghost username, when the commit email matches an account.',
    type: String,
    nullable: true,
  })
  username: string | null;

  @ApiProperty({ description: 'Commit author name, as written in git.' })
  name: string;

  @ApiProperty({
    description: 'Avatar of the linked account, if any.',
    type: String,
    nullable: true,
  })
  image: string | null;

  @ApiProperty({ description: 'Commits by this author on the walked ref.' })
  commits: number;

  @ApiProperty({ description: 'Share of the walked commits, 0-100.' })
  percent: number;

  @ApiProperty({ description: 'Most recent commit by this author, ISO 8601.' })
  lastCommittedAt: string;
}

export class GetRepositoryContributorsResponseDTO {
  @ApiProperty({ type: [ContributorDTO] })
  contributors: ContributorDTO[];

  @ApiProperty({ description: 'Commits walked in total.' })
  totalCommits: number;

  @ApiProperty({ description: 'Distinct authors walked in total.' })
  totalContributors: number;
}
