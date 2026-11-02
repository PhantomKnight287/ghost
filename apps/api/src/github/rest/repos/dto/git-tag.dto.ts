import { ApiProperty } from '@nestjs/swagger';

import {
  GithubCommitVerificationDTO,
  GithubGitActorDTO,
} from '../../pulls/dto/pull.dto.js';

export class GithubGitTagObjectDTO {
  @ApiProperty({ example: 'commit' })
  type: string;

  @ApiProperty()
  sha: string;

  @ApiProperty()
  url: string;
}

export class GithubGitTagDTO {
  @ApiProperty()
  node_id: string;

  @ApiProperty({ example: 'v1.0.0' })
  tag: string;

  @ApiProperty({ description: 'The tag object, not the commit it points at.' })
  sha: string;

  @ApiProperty()
  url: string;

  @ApiProperty({
    description: 'The message as stored, without the signature block.',
  })
  message: string;

  @ApiProperty({ type: GithubGitActorDTO, nullable: true })
  tagger: GithubGitActorDTO | null;

  @ApiProperty({ type: GithubGitTagObjectDTO })
  object: GithubGitTagObjectDTO;

  @ApiProperty({ type: GithubCommitVerificationDTO })
  verification: GithubCommitVerificationDTO;
}
