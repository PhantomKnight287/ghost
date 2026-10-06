import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

import { LFS_OID } from '../../lib/git/lfs/lfs-objects.js';

export class LfsObjectSpecDTO {
  @Matches(LFS_OID)
  oid: string;

  @IsInt()
  @Min(0)
  size: number;
}

/** The fields of a batch request Ghost reads. `transfers` and `ref` are ignored: only `basic` is spoken, and refs carry no permissions of their own. */
export class LfsBatchRequestDTO {
  @IsIn(['download', 'upload'])
  operation: 'download' | 'upload';

  @IsOptional()
  @IsIn(['sha256'])
  hash_algo?: 'sha256';

  // git-lfs sends 100 at a time
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => LfsObjectSpecDTO)
  objects: LfsObjectSpecDTO[];
}
