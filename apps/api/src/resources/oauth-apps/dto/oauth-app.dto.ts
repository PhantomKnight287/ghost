import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

export const MAX_NAME_LENGTH = 100;

/** https off the loopback host, or plain http on it for local development: the two shapes the oauth-provider plugin accepts, as web and native clients. */
const CALLBACK_URL =
  /^(https:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])([:/]|$))|http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/;

export class CreateOauthAppDTO {
  @ApiProperty({ maxLength: MAX_NAME_LENGTH, example: 'Release bot' })
  @IsString()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({ example: 'https://bot.example' })
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  homepageUrl: string;

  @ApiProperty({
    description:
      'Where users return after authorizing. A redirect_uri must share its host and port, with a path equal to or under its path.',
    example: 'https://bot.example/oauth/callback',
  })
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @Matches(CALLBACK_URL, {
    message: 'callbackUrl must use https, or http on localhost',
  })
  callbackUrl: string;

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

  @ApiProperty()
  homepageUrl: string;

  @ApiProperty()
  callbackUrl: string;

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

  @ApiProperty()
  homepageUrl: string;

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
