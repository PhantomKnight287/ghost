import { ApiProperty } from '@nestjs/swagger';

import { CodeownersErrorDTO } from '../../../../resources/repositories/dto/codeowners.dto.js';

export class GithubRepositoryOwnerDTO {
  @ApiProperty({ example: 'octocat' })
  login: string;

  @ApiProperty()
  html_url: string;
}

export class GithubRepositoryPermissionsDTO {
  @ApiProperty()
  admin: boolean;

  @ApiProperty()
  maintain: boolean;

  @ApiProperty()
  push: boolean;

  @ApiProperty()
  triage: boolean;

  @ApiProperty()
  pull: boolean;
}

export class GithubRepositoryDTO {
  @ApiProperty({ type: Number, nullable: true })
  id: number | null;

  @ApiProperty()
  node_id: string;

  @ApiProperty({ example: 'hello-world' })
  name: string;

  @ApiProperty({ example: 'octocat/hello-world' })
  full_name: string;

  @ApiProperty()
  private: boolean;

  @ApiProperty({ enum: ['public', 'private'] })
  visibility: string;

  @ApiProperty({ type: GithubRepositoryOwnerDTO })
  owner: GithubRepositoryOwnerDTO;

  @ApiProperty()
  html_url: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  fork: boolean;

  @ApiProperty()
  url: string;

  @ApiProperty()
  clone_url: string;

  @ApiProperty({ type: String, nullable: true })
  ssh_url: string | null;

  @ApiProperty({ example: 'main' })
  default_branch: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pushed_at: string | null;

  @ApiProperty()
  has_issues: boolean;

  @ApiProperty({
    type: GithubRepositoryPermissionsDTO,
    nullable: true,
    description:
      "The viewer's access; null when the viewer has no role on the repository.",
  })
  permissions: GithubRepositoryPermissionsDTO | null;
}

export class GithubReadmeDTO {
  @ApiProperty({ example: 'file' })
  type: string;

  @ApiProperty({ example: 'base64' })
  encoding: string;

  @ApiProperty()
  size: number;

  @ApiProperty({ example: 'README.md' })
  name: string;

  @ApiProperty({ example: 'README.md' })
  path: string;

  @ApiProperty({ description: 'The file, base64-encoded.' })
  content: string;
}

export class GithubCodeownersErrorsDTO {
  @ApiProperty({ type: [CodeownersErrorDTO] })
  errors: CodeownersErrorDTO[];
}
