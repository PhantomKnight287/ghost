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

  @ApiPropertyOptional({
    description:
      "Slug of the organization to fork into; the requester's own account when omitted. Needs admin in the organization.",
  })
  @IsString()
  @IsOptional()
  organization?: string;
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

export class TransferRepositoryRequestDTO {
  @ApiProperty({
    description:
      "The new owner: the requester's own username, or the slug of an organization the requester administers.",
  })
  @IsString()
  owner: string;
}

export class TransferRepositoryResponseDTO extends ForkRepositoryResponseDTO {
  @ApiProperty({
    description:
      'True when the recipient has to accept it first; the repository has not moved yet.',
  })
  pending: boolean;
}

export class IncomingTransferRepositoryDTO {
  @ApiProperty()
  owner: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;
}

export class IncomingTransferDTO {
  @ApiProperty()
  repositoryId: string;

  @ApiProperty({ type: IncomingTransferRepositoryDTO })
  repository: IncomingTransferRepositoryDTO;

  @ApiProperty({ description: 'The account or organization it would move to.' })
  to: string;

  @ApiProperty({ type: String, nullable: true })
  requestedByUsername: string | null;

  @ApiProperty()
  createdAt: string;
}

export class ListIncomingTransfersResponseDTO {
  @ApiProperty({ type: [IncomingTransferDTO] })
  transfers: IncomingTransferDTO[];
}
