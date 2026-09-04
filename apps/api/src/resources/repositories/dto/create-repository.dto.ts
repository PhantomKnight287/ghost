import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateRepositoryRequestDTO {
  @ApiProperty({})
  @IsString()
  name: string;

  @ApiPropertyOptional({})
  @IsString()
  @IsOptional()
  description?: string;
}


export class CreateRepositoryResponseDTO{
  @ApiProperty()
  @IsString()
  id: string

  @ApiProperty()
  @IsString()
  slug:string
}
