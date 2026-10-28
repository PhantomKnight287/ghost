import { ApiProperty } from '@nestjs/swagger';

import { GithubSimpleUserDTO } from '../../users/dto/user.dto.js';

/** GitHub's integration object, as `GET /app` returns it. */
export class GithubAppDTO {
  @ApiProperty({ description: 'The App ID, the JWT `iss`.' })
  id: number;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ type: GithubSimpleUserDTO })
  owner: GithubSimpleUserDTO;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  external_url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', enum: ['read', 'write'] },
  })
  permissions: Record<string, 'read' | 'write'>;

  @ApiProperty({ type: [String] })
  events: string[];

  @ApiProperty()
  installations_count: number;
}
