import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PullRequestCommentDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ description: 'Markdown, rendered by the client.' })
  @IsString()
  body: string;

  @ApiProperty()
  @IsString()
  authorUsername: string;

  @ApiProperty()
  @IsISO8601()
  createdAt: string;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;
}

export class CreatePullRequestCommentRequestDTO {
  @ApiProperty({ maxLength: 20000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  body: string;
}

export class GetPullRequestCommentsResponseDTO {
  @ApiProperty({ type: [PullRequestCommentDTO] })
  @ValidateNested({ each: true })
  @Type(() => PullRequestCommentDTO)
  comments: PullRequestCommentDTO[];
}
