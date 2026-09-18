import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetUserContributionsQueryDTO {
  @ApiPropertyOptional({
    description: 'Calendar year to render. Defaults to the current year.',
    example: 2026,
  })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  @IsOptional()
  year?: number;
}

export class ContributionDayDTO {
  @ApiProperty({
    description: 'Calendar day, YYYY-MM-DD (UTC).',
    example: '2026-09-18',
  })
  date: string;

  @ApiProperty({ description: 'Commits authored that day.' })
  count: number;
}

export class GetUserContributionsResponseDTO {
  @ApiProperty()
  username: string;

  @ApiProperty({ description: 'Calendar year rendered.' })
  year: number;

  @ApiProperty({
    description:
      'Commits authored that year across visible owned repositories.',
  })
  totalContributions: number;

  @ApiProperty({
    type: [ContributionDayDTO],
    description: 'Every day of the year, in order.',
  })
  days: ContributionDayDTO[];
}
