import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class RepositoryLanguageDTO {
  @ApiProperty({ example: 'TypeScript' })
  @IsString()
  language: string;

  @ApiProperty({
    description: 'Total size of the files in this language.',
    example: 128_400,
  })
  @IsNumber()
  bytes: number;

  @ApiProperty({
    description: 'Share of the counted bytes, 0-100.',
    example: 72.4,
  })
  @IsNumber()
  percent: number;
}

export class GetRepositoryLanguagesResponseDTO {
  @ApiProperty({
    type: [RepositoryLanguageDTO],
    description: 'Languages on the default branch, largest first.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepositoryLanguageDTO)
  languages: RepositoryLanguageDTO[];
}
