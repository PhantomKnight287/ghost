import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class IssueCommentDTO {
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

export class CreateIssueCommentRequestDTO {
  @ApiProperty({ maxLength: 20000 })
  @IsString()
  @IsNotEmpty()
  @Matches(/.*\S.*/, { message: 'Write something first.' })
  @MaxLength(20000)
  body: string;
}

export class UpdateIssueCommentRequestDTO {
  @ApiProperty({ maxLength: 20000 })
  @IsString()
  @IsNotEmpty()
  @Matches(/.*\S.*/, { message: 'Write something first.' })
  @MaxLength(20000)
  body: string;
}

export class GetIssueCommentsResponseDTO {
  @ApiProperty({ type: [IssueCommentDTO] })
  @ValidateNested({ each: true })
  @Type(() => IssueCommentDTO)
  comments: IssueCommentDTO[];
}
