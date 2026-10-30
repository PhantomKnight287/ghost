import { ApiProperty } from '@nestjs/swagger';

/** The Ghost App a user-to-server token acted through; the user is still the author. */
export class ViaAppDTO {
  @ApiProperty({ description: 'The App ID.' })
  appId: number;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;
}
