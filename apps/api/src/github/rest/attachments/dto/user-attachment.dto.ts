import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** GitHub's user-attachments upload query. Ghost serves a file by its extension, so `content_type` is accepted and ignored. */
export class GithubUploadUserAttachmentQueryDTO {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content_type?: string;

  @ApiProperty({
    description:
      'The numeric REST id of the repository the file is attached in.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repository_id: number;
}

export class GithubUserAttachmentDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  content_type: string;

  @ApiProperty({
    description:
      'Where the repository serves the file; embed it in any issue, pull request, comment or release of that repository.',
  })
  url: string;
}
