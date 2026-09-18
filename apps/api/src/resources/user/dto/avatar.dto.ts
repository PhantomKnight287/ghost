import { ApiProperty } from '@nestjs/swagger';

export class UploadAvatarResponseDTO {
  @ApiProperty({
    description: 'Absolute URL the stored avatar is served from',
    example: 'http://localhost:3001/api/users/avatars/<userId>/<name>.png',
  })
  url: string;
}
