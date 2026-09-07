import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt } from 'class-validator';

export class StarRepositoryResponseDTO {
  @ApiProperty()
  @IsInt()
  starCount: number;

  @ApiProperty()
  @IsBoolean()
  viewerHasStarred: boolean;
}
