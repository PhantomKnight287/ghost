import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { schema } from '@ghost/db';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ForkRepositoryRequestDTO {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  @IsIn(schema.repositoryVisiblity.enumValues)
  visibility: (typeof schema.repositoryVisiblity.enumValues)[number];
}

export class ForkRepositoryResponseDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  slug: string;

  @ApiProperty()
  @IsString()
  username: string;
}
