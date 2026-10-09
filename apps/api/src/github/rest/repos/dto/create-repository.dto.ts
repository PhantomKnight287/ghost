import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Accepted and ignored: Ghost cannot write an initial commit from the API yet.' })
  @IsOptional()
  @IsBoolean()
  auto_init?: boolean;

  @ApiPropertyOptional({ description: 'Accepted and ignored.' })
  @IsOptional()
  @IsString()
  gitignore_template?: string;

  @ApiPropertyOptional({ description: 'Accepted and ignored.' })
  @IsOptional()
  @IsString()
  license_template?: string;
}
