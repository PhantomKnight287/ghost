import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** An 8192-bit RSA key with a long comment still fits inside this several times over. */
export const MAX_PUBLIC_KEY_LENGTH = 16 * 1024;

export const MAX_TITLE_LENGTH = 100;

export class AddSshKeyDTO {
  @ApiProperty({
    description:
      'One authorized_keys line, as `~/.ssh/id_ed25519.pub` holds it.',
    example: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... laptop',
    maxLength: MAX_PUBLIC_KEY_LENGTH,
  })
  @IsString()
  @MaxLength(MAX_PUBLIC_KEY_LENGTH)
  publicKey: string;

  @ApiProperty({
    description:
      "What to call the key. Defaults to the key's own comment, then to its type.",
    required: false,
    maxLength: MAX_TITLE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;
}

export class SshKeyDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'What the key is called on this account.' })
  title: string;

  @ApiProperty({ description: 'Key algorithm, e.g. `ssh-ed25519`.' })
  type: string;

  @ApiProperty({
    description: 'SHA256 fingerprint, base64, as `ssh-keygen -lf` prints it.',
  })
  fingerprint: string;

  @ApiProperty({
    description: 'When the key last authenticated a git session, ISO 8601.',
    nullable: true,
  })
  lastUsedAt: string | null;

  @ApiProperty({ description: 'When the key was added, ISO 8601.' })
  createdAt: string;
}

export class ListSshKeysResponseDTO {
  @ApiProperty({ type: [SshKeyDTO] })
  keys: SshKeyDTO[];
}
