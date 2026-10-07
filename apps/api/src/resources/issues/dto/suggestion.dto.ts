import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SuggestionQueryDTO {
  @ApiPropertyOptional({
    description:
      'What has been typed so far. Empty suggests the people or issues most likely meant.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  q?: string;
}

export class SuggestedUserDTO {
  @ApiProperty()
  @IsString()
  username: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  image: string | null;
}

export class SuggestedUsersResponseDTO {
  @ApiProperty({ type: [SuggestedUserDTO] })
  @ValidateNested({ each: true })
  @Type(() => SuggestedUserDTO)
  users: SuggestedUserDTO[];
}

export class SuggestedIssueDTO {
  @ApiProperty()
  @IsInt()
  number: number;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ enumName: 'IssueState', enum: schema.issueState.enumValues })
  @IsIn(schema.issueState.enumValues)
  state: (typeof schema.issueState.enumValues)[number];

  @ApiProperty()
  @IsBoolean()
  isPullRequest: boolean;
}

export class SuggestedIssuesResponseDTO {
  @ApiProperty({ type: [SuggestedIssueDTO] })
  @ValidateNested({ each: true })
  @Type(() => SuggestedIssueDTO)
  issues: SuggestedIssueDTO[];
}
