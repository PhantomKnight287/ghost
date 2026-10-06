import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MAX_TREE_PATH_LENGTH } from '../../lib/git/tree/tree-path.js';

/** `ref` is ignored: a lock covers its path on every branch. */
export class CreateLfsLockDTO {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TREE_PATH_LENGTH)
  path: string;
}

export class LfsLocksPageDTO {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ListLfsLocksQueryDTO extends LfsLocksPageDTO {
  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  id?: string;
}

export class UnlockLfsLockDTO {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
