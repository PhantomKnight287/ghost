import { schema } from '@ghost/db';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

type OauthAppAccessState =
  (typeof schema.organizationOauthAppState.enumValues)[number];

export class OauthAppAccessDTO {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  homepageUrl: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The user or organization that registered it; null for an app built into Ghost.',
  })
  owner: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Every scope members of this organization granted the app, so admins see what approving it lets it do.',
  })
  scopes: string[];

  @ApiProperty({ enum: schema.organizationOauthAppState.enumValues })
  state: OauthAppAccessState;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who asked for the app; null when an admin decided first.',
  })
  requestedBy: string | null;

  @ApiProperty()
  requestedAt: string;

  @ApiProperty({ type: String, nullable: true })
  decidedBy: string | null;

  @ApiProperty({ type: String, nullable: true })
  decidedAt: string | null;
}

export class ListOauthAppAccessResponseDTO {
  @ApiProperty({
    description:
      'Whether the organization restricts OAuth apps at all; the answers below matter only while it does.',
  })
  restricted: boolean;

  @ApiProperty({
    type: [OauthAppAccessDTO],
    description: 'Newest request first.',
  })
  apps: OauthAppAccessDTO[];
}

export class DecideOauthAppAccessDTO {
  @ApiProperty({ enum: ['approved', 'denied'] })
  @IsIn(['approved', 'denied'])
  state: 'approved' | 'denied';
}

export class OauthAppOrganizationAccessDTO {
  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  restricted: boolean;

  @ApiProperty({
    description:
      "Whether the app's keys reach the organization's repositories now.",
  })
  allowed: boolean;

  @ApiProperty({
    enum: schema.organizationOauthAppState.enumValues,
    nullable: true,
    description: 'Null when nobody has asked for the app yet.',
  })
  state: OauthAppAccessState | null;
}

export class ListOauthAppOrganizationAccessResponseDTO {
  @ApiProperty({ type: [OauthAppOrganizationAccessDTO] })
  organizations: OauthAppOrganizationAccessDTO[];
}
