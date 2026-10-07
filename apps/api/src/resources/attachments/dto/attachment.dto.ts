import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength } from 'class-validator';

export class UploadAttachmentQueryDTO {
  @ApiProperty({
    description:
      'File name, whose extension decides what the file is served as.',
    example: 'screenshot.png',
  })
  @IsString()
  @MaxLength(255)
  name: string;
}

export class AttachmentDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ example: 'screenshot.png' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  contentType: string;

  @ApiProperty()
  @IsInt()
  size: number;
}
