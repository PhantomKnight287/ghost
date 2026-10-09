import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_PUBLIC_KEY_LENGTH, MAX_TITLE_LENGTH } from '../../../../resources/ssh-keys/dto/ssh-key.dto.js';

/** GitHub's add-key body. */
export class GithubAddKeyDTO {
  @ApiPropertyOptional({ maxLength: MAX_TITLE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @ApiProperty({ description: 'One authorized_keys line.', maxLength: MAX_PUBLIC_KEY_LENGTH })
  @IsString()
  @MaxLength(MAX_PUBLIC_KEY_LENGTH)
  key: string;
}
