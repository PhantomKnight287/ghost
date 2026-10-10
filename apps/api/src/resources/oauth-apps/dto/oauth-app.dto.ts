import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 400;
export const MAX_CALLBACK_URLS = 10;

/** https off the loopback host, or plain http on it for local development: the shapes the oauth-provider plugin accepts from a native client. */
const CALLBACK_URL =
  /^(https:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])([:/]|$))|http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/;

export class CreateOauthAppDTO {
  @ApiProperty({ maxLength: MAX_NAME_LENGTH, example: 'Release bot' })
  @IsString()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({
    required: false,
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: 'Shown to users when they are asked to authorize the app.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiProperty({ example: 'https://bot.example' })
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  homepageUrl: string;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: MAX_CALLBACK_URLS,
    description:
      "Where users may return after authorizing. A redirect_uri must share one's scheme, host and port, with a path equal to or under its path; without one, users return to the first.",
    example: ['https://bot.example/oauth/callback'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CALLBACK_URLS)
  @ArrayUnique()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false }, { each: true })
  @Matches(CALLBACK_URL, {
    each: true,
    message: 'Each callback URL must use https, or http on localhost',
  })
  callbackUrls: string[];

  @ApiProperty({
    required: false,
    default: false,
    description: 'Lets the app sign users in with the device flow, as gh does.',
  })
  @IsOptional()
  @IsBoolean()
  deviceFlowEnabled?: boolean;
}

export class UpdateOauthAppDTO extends PartialType(CreateOauthAppDTO) {}

export class OauthAppDTO {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  homepageUrl: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;

  @ApiProperty({ type: [String] })
  callbackUrls: string[];

  @ApiProperty()
  deviceFlowEnabled: boolean;

  @ApiProperty({ description: 'When the app was registered, ISO 8601.' })
  createdAt: string;
}

export class CreatedOauthAppDTO extends OauthAppDTO {
  @ApiProperty({
    description: 'Shown only now. Store it: Ghost keeps only a hash.',
  })
  clientSecret: string;
}

export class OauthAppSecretDTO {
  @ApiProperty({
    description:
      'The new secret, shown only now. The previous one stops working at once.',
  })
  clientSecret: string;
}

export class ListOauthAppsResponseDTO {
  @ApiProperty({ type: [OauthAppDTO] })
  apps: OauthAppDTO[];
}

export class AuthorizingOauthAppDTO {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  homepageUrl: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Username of the account that registered the app; null for an app built into Ghost.',
  })
  owner: string | null;
}

export class AuthorizedOauthAppDTO {
  @ApiProperty()
  clientId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;

  @ApiProperty({
    type: [String],
    description: 'Every scope the app holds across its keys for this account.',
  })
  scopes: string[];

  @ApiProperty({ description: 'When the app was first authorized, ISO 8601.' })
  authorizedAt: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When one of its keys was last used, ISO 8601.',
  })
  lastUsedAt: string | null;
}

export class ListAuthorizedOauthAppsResponseDTO {
  @ApiProperty({ type: [AuthorizedOauthAppDTO] })
  apps: AuthorizedOauthAppDTO[];
}
