import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

import {
  IsGitignoreTemplate,
  IsLicenseTemplate,
} from '../../../../lib/repositories/template-fields.js';

/** GitHub's create-repository body; every field gh may send is declared so the global whitelist keeps it. */
export class GithubCreateRepositoryDTO {
  @ApiProperty({ example: 'tools' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Ignored when `visibility` is given.' })
  @IsOptional()
  @IsBoolean()
  private?: boolean;

  @ApiPropertyOptional({ enum: ['public', 'private'] })
  @IsOptional()
  @IsIn(['public', 'private'])
  visibility?: 'public' | 'private';

  @ApiPropertyOptional({
    description: 'Starts the repository with a commit holding a README.',
  })
  @IsOptional()
  @IsBoolean()
  auto_init?: boolean;

  @ApiPropertyOptional({
    description:
      'A name from `GET /gitignore/templates`, in any case; its `.gitignore` goes in the first commit.',
    example: 'Node',
  })
  @IsGitignoreTemplate()
  gitignore_template?: string;

  @ApiPropertyOptional({
    description:
      'A key from `GET /licenses`, in any case; its text, with the owner and year filled in, goes in the first commit as `LICENSE`.',
    example: 'mit',
  })
  @IsLicenseTemplate()
  license_template?: string;
}
