import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** Armor for a 4096-bit key with a few user ids still fits well inside this. */
export const MAX_PUBLIC_KEY_LENGTH = 64 * 1024;

export class AddGpgKeyDTO {
  @ApiProperty({
    description:
      'Armored OpenPGP public key, as `gpg --armor --export` prints it.',
    example: '-----BEGIN PGP PUBLIC KEY BLOCK-----\n...',
    maxLength: MAX_PUBLIC_KEY_LENGTH,
  })
  @IsString()
  @MaxLength(MAX_PUBLIC_KEY_LENGTH)
  publicKey: string;
}

export class GpgKeyDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description: 'Long key id, lowercase hex. Signatures name this.',
  })
  keyId: string;

  @ApiProperty({ description: 'Full fingerprint, lowercase hex.' })
  fingerprint: string;

  @ApiProperty({
    type: [String],
    description: "Addresses the key's user ids claim.",
  })
  emails: string[];

  @ApiProperty({ description: 'When the key was added, ISO 8601.' })
  createdAt: string;
}

export class ListGpgKeysResponseDTO {
  @ApiProperty({ type: [GpgKeyDTO] })
  keys: GpgKeyDTO[];
}
