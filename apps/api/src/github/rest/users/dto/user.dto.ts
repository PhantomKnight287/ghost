import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** GitHub's simple-user, embedded wherever a response names a user. */
export class GithubSimpleUserDTO {
  @ApiProperty({ example: 'octocat' })
  login: string;

  @ApiProperty()
  id: number;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ description: 'Empty when the account has no avatar.' })
  avatar_url: string;

  @ApiProperty({ example: '' })
  gravatar_id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  html_url: string;

  @ApiProperty()
  followers_url: string;

  @ApiProperty()
  following_url: string;

  @ApiProperty()
  gists_url: string;

  @ApiProperty()
  starred_url: string;

  @ApiProperty()
  subscriptions_url: string;

  @ApiProperty()
  organizations_url: string;

  @ApiProperty()
  repos_url: string;

  @ApiProperty()
  events_url: string;

  @ApiProperty()
  received_events_url: string;

  @ApiProperty({ enum: ['User', 'Organization', 'Bot'] })
  type: 'User' | 'Organization' | 'Bot';

  @ApiProperty({ example: false })
  site_admin: boolean;
}

export class GithubUserDTO extends GithubSimpleUserDTO {
  @ApiProperty({ type: String, nullable: true })
  name: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Users only; an organization leaves it out.',
  })
  updated_at?: string;
}

export class GithubAuthenticatedUserDTO extends GithubUserDTO {
  @ApiProperty()
  email: string;
}

export class GithubKeyDTO {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Ghost keeps no integer id for authentication keys.',
  })
  id: null;

  @ApiProperty({ description: 'The authorized_keys line.' })
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ example: false })
  read_only: boolean;

  @ApiProperty({ example: true })
  verified: boolean;
}

export class GithubSigningKeyDTO {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'The authorized_keys line.' })
  key: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}
