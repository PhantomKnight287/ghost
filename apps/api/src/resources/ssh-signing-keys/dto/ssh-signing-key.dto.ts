import { ApiProperty } from '@nestjs/swagger';

export class SshSigningKeyDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'What the key is called on this account.' })
  title: string;

  @ApiProperty({ description: 'Key algorithm, e.g. `ssh-ed25519`.' })
  type: string;

  @ApiProperty({
    description: 'The key as `<type> <base64>`, without its comment.',
    example: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI...',
  })
  publicKey: string;

  @ApiProperty({
    description: 'SHA256 fingerprint, base64, as `ssh-keygen -lf` prints it.',
  })
  fingerprint: string;

  @ApiProperty({ description: 'When the key was added, ISO 8601.' })
  createdAt: string;
}

export class ListSshSigningKeysResponseDTO {
  @ApiProperty({ type: [SshSigningKeyDTO] })
  keys: SshSigningKeyDTO[];
}
