import {
  ApiDefaultResponse,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

export class GithubValidationFailureDTO {
  @ApiPropertyOptional({
    example: 'Label',
    description: 'Left out when a body field failed its own validation.',
  })
  resource?: string;

  @ApiProperty({ example: 'name' })
  field: string;

  @ApiProperty({
    enum: ['missing_field', 'invalid', 'already_exists'],
    example: 'already_exists',
  })
  code: string;

  @ApiPropertyOptional({
    description: 'What a body field failed, when it failed its own validation.',
  })
  message?: string;
}

/** GitHub REST's error body, from GithubRestFilter. */
export class GithubErrorDTO {
  @ApiProperty({ example: 'Validation Failed' })
  message: string;

  @ApiProperty({ example: 'https://docs.github.com/rest' })
  documentation_url: string;

  @ApiPropertyOptional({
    example: '422',
    description: 'The HTTP status as a string. A 429 leaves it out.',
  })
  status?: string;

  @ApiPropertyOptional({
    type: [GithubValidationFailureDTO],
    description: 'On a 422 only: the fields that failed.',
  })
  errors?: GithubValidationFailureDTO[];
}

/** Every GitHub-compatible controller answers errors through GithubRestFilter. */
export const ApiGithubErrors = () =>
  ApiDefaultResponse({
    type: GithubErrorDTO,
    description:
      "GitHub's error body. A 404 reads `Not Found` whether the resource is missing or the viewer cannot see it.",
  });
