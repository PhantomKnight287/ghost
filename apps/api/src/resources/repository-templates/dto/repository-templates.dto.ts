import { ApiProperty } from '@nestjs/swagger';

export class LicenseTemplateDTO {
  @ApiProperty({ example: 'mit' })
  key: string;

  @ApiProperty({ example: 'MIT License' })
  name: string;
}

export class GetRepositoryTemplatesResponseDTO {
  @ApiProperty({ type: [String], example: ['Go', 'Node'] })
  gitignore: string[];

  @ApiProperty({ type: [LicenseTemplateDTO] })
  licenses: LicenseTemplateDTO[];
}
