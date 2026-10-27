import { ApiProperty } from '@nestjs/swagger';

export class GithubGitignoreTemplateDTO {
  @ApiProperty({ example: 'Node' })
  name: string;

  @ApiProperty({ description: 'The .gitignore file.' })
  source: string;
}

export class GithubLicenseSummaryDTO {
  @ApiProperty({ example: 'mit' })
  key: string;

  @ApiProperty({ example: 'MIT License' })
  name: string;

  @ApiProperty({ example: 'MIT' })
  spdx_id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  node_id: string;
}

export class GithubLicenseDTO extends GithubLicenseSummaryDTO {
  @ApiProperty()
  html_url: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  implementation: string;

  @ApiProperty({ type: [String] })
  permissions: string[];

  @ApiProperty({ type: [String] })
  conditions: string[];

  @ApiProperty({ type: [String] })
  limitations: string[];

  @ApiProperty({
    description: 'The license text, with placeholders such as `[year]`.',
  })
  body: string;

  @ApiProperty()
  featured: boolean;
}
