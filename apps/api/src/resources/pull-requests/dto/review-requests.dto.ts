import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewRequestsBodyDTO {
  @ApiPropertyOptional({ description: 'Usernames.', example: ['octocat'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  users?: string[];

  @ApiPropertyOptional({
    description: "Slugs of the organization's teams.",
    example: ['core'],
  })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  teams?: string[];
}

export class RequestedUserDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar URL.' })
  image: string | null;

  @ApiProperty({ description: 'Requested by CODEOWNERS rather than a person.' })
  asCodeOwner: boolean;
}

export class RequestedTeamDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'core' })
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Requested by CODEOWNERS rather than a person.' })
  asCodeOwner: boolean;
}

export class RequestedReviewersDTO {
  @ApiProperty({ type: [RequestedUserDTO] })
  users: RequestedUserDTO[];

  @ApiProperty({ type: [RequestedTeamDTO] })
  teams: RequestedTeamDTO[];
}
