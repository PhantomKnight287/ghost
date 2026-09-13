import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDTO {
  @ApiProperty()
  username: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true, type: String })
  image: string | null;

  @ApiProperty({ description: 'ISO timestamp the account was created' })
  joinedAt: string;

  @ApiProperty({ description: 'Public repositories owned by the user' })
  repositoryCount: number;

  @ApiProperty({ description: 'Stars across the user’s public repositories' })
  starCount: number;
}
