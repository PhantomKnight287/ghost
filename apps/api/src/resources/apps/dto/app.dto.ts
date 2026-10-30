import type { AppPermissions } from '@ghost/permissions';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  CALLBACK_URL,
  MAX_CALLBACK_URLS,
} from '../../oauth-apps/dto/oauth-app.dto.js';

export const MAX_APP_NAME_LENGTH = 34;
export const MAX_APP_DESCRIPTION_LENGTH = 400;
const MAX_URL_LENGTH = 2048;
const URL_OPTIONS = {
  protocols: ['http', 'https'],
  require_tld: false,
  require_protocol: true,
};

const permissionsProperty = {
  type: 'object' as const,
  additionalProperties: { type: 'string' as const, enum: ['read', 'write'] },
  example: { contents: 'read', statuses: 'write' },
};

export class CreateAppDTO {
  @ApiProperty({
    minLength: 1,
    maxLength: MAX_APP_NAME_LENGTH,
    example: 'CI Bot',
    description:
      'The slug, and the bot user `slug[bot]`, are made from it once and never change.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_APP_NAME_LENGTH)
  name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAX_APP_DESCRIPTION_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_APP_DESCRIPTION_LENGTH)
  description?: string | null;

  @ApiProperty({ example: 'https://bot.example' })
  @IsUrl(URL_OPTIONS)
  @MaxLength(MAX_URL_LENGTH)
  homepageUrl: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Where an owner is sent after installing the app.',
  })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(MAX_URL_LENGTH)
  setupUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Where Ghost delivers the events the app subscribes to.',
  })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(MAX_URL_LENGTH)
  webhookUrl?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    writeOnly: true,
    description: 'Signs every delivery. Never returned.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  webhookSecret?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_CALLBACK_URLS,
    description:
      'Where users return after signing in to the app; a redirect_uri must match one.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CALLBACK_URLS)
  @ArrayUnique()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false }, { each: true })
  @Matches(CALLBACK_URL, {
    each: true,
    message: 'Each callback URL must use https, or http on localhost',
  })
  callbackUrls?: string[];

  @ApiPropertyOptional({
    description:
      'GitHub\'s "Expire user authorization tokens": tokens last 8 hours and come with a refresh token. On by default.',
  })
  @IsOptional()
  @IsBoolean()
  expireUserTokens?: boolean;

  @ApiPropertyOptional({ description: 'Lets the app use the device flow.' })
  @IsOptional()
  @IsBoolean()
  deviceFlowEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Sends the installer through the web flow right after installing. Needs a callback URL.',
  })
  @IsOptional()
  @IsBoolean()
  requestOauthOnInstall?: boolean;

  @ApiProperty({
    ...permissionsProperty,
    description:
      "GitHub's permission names and levels. `metadata: read` is always granted.",
  })
  @IsObject()
  permissions: Record<string, string>;

  @ApiProperty({
    type: [String],
    example: ['push', 'pull_request.synchronized'],
    description:
      'Ghost webhook events. Each needs read on the permission it belongs to.',
  })
  @IsArray()
  @IsString({ each: true })
  events: string[];
}

export class UpdateAppDTO extends PartialType(CreateAppDTO) {
  @ApiPropertyOptional({
    description:
      'Turns the webhook off or back on. Turning it on clears the reason Ghost turned it off.',
  })
  @IsOptional()
  @IsBoolean()
  webhookActive?: boolean;
}

export class AppOwnerDTO {
  @ApiProperty({ description: 'Username, or organization slug.' })
  login: string;

  @ApiProperty({ enum: ['user', 'organization'] })
  type: 'user' | 'organization';
}

export class AppPrivateKeyDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({
    example: 'SHA256:0f3V…',
    description: 'SHA-256 of the public key, base64.',
  })
  fingerprint: string;

  @ApiProperty({ description: 'ISO 8601.' })
  createdAt: string;
}

export class CreatedPrivateKeyDTO extends AppPrivateKeyDTO {
  @ApiProperty({
    description:
      'PKCS#1 PEM, shown only now. Ghost keeps only the public half.',
  })
  privateKey: string;
}

export class PublicAppDTO {
  @ApiProperty({
    description: 'The App ID: the JWT `iss`, and `integration_id` in rulesets.',
  })
  appId: number;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  homepageUrl: string;

  @ApiProperty({ type: String, nullable: true })
  logoUrl: string | null;

  @ApiProperty({ type: AppOwnerDTO })
  owner: AppOwnerDTO;

  @ApiProperty({ description: 'The web page an owner installs the app from.' })
  installUrl: string;

  @ApiProperty({
    ...permissionsProperty,
    description: 'What an installation accepts, shown before installing.',
  })
  permissions: AppPermissions;

  @ApiProperty({ type: [String] })
  events: string[];
}

export class AppDTO extends PublicAppDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'ci-bot[bot]' })
  botLogin: string;

  @ApiProperty({ type: String, nullable: true })
  setupUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  webhookUrl: string | null;

  @ApiProperty()
  webhookSecretSet: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The app's webhook endpoint, for its deliveries. Null without a webhook URL.",
  })
  webhookId: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'What Octokit calls clientId. Null only in lists, for an app made before user sign-in existed, until it is first opened.',
  })
  clientId: string | null;

  @ApiProperty({ type: [String] })
  callbackUrls: string[];

  @ApiProperty()
  expireUserTokens: boolean;

  @ApiProperty()
  deviceFlowEnabled: boolean;

  @ApiProperty()
  requestOauthOnInstall: boolean;

  @ApiProperty({ type: () => [AppClientSecretDTO] })
  clientSecrets: AppClientSecretDTO[];

  @ApiProperty({
    description: 'False when turned off, by the owner or by Ghost.',
  })
  webhookActive: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why Ghost turned the webhook off.',
  })
  webhookDisabledReason: string | null;

  @ApiProperty({ description: 'Accounts the app is installed on.' })
  installationsCount: number;

  @ApiProperty({ type: [AppPrivateKeyDTO] })
  privateKeys: AppPrivateKeyDTO[];

  @ApiProperty({ description: 'ISO 8601.' })
  createdAt: string;
}

export class ListAppsResponseDTO {
  @ApiProperty({ type: [AppDTO] })
  apps: AppDTO[];
}

export class AppClientSecretDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'The last 8 characters, to tell secrets apart.' })
  lastEight: string;

  @ApiProperty({ description: 'ISO 8601.' })
  createdAt: string;
}

export class CreatedClientSecretDTO extends AppClientSecretDTO {
  @ApiProperty({ description: 'Shown once.' })
  clientSecret: string;
}
