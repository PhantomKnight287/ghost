import { ApiProperty } from '@nestjs/swagger';

export class GithubMetaDTO {
  @ApiProperty({
    example: '3.17.0',
    description:
      'The GitHub Enterprise Server version Ghost answers as, which decides the search syntax gh uses.',
  })
  installed_version: string;

  @ApiProperty({ example: false })
  verifiable_password_authentication: boolean;
}
