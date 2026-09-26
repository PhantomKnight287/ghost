import { schema } from '@ghost/db';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import type { CollaboratorRole } from '../../../lib/git/repository-access/repository-access.js';

const roleProperty = {
  enumName: 'RepositoryRole',
  enum: schema.repositoryRole.enumValues,
};

export const collaboratorStatuses = ['accepted', 'pending', 'expired'] as const;
export type CollaboratorStatus = (typeof collaboratorStatuses)[number];

export class InviteCollaboratorRequestDTO {
  @ApiProperty({
    ...roleProperty,
    description:
      'A new invitation is sent with this role; for someone already invited or collaborating, the role is changed in place.',
  })
  @IsIn(schema.repositoryRole.enumValues)
  role: CollaboratorRole;
}

export class CollaboratorDTO {
  @ApiProperty()
  username: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  image: string | null;

  @ApiProperty(roleProperty)
  role: CollaboratorRole;

  @ApiProperty({
    enumName: 'CollaboratorStatus',
    enum: collaboratorStatuses,
    description:
      'Only `accepted` grants access. An `expired` invitation is sent again by inviting the user again.',
  })
  status: CollaboratorStatus;

  @ApiProperty()
  invitedAt: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the invitation lapses, or lapsed. Null once accepted.',
  })
  expiresAt: string | null;
}

export class ListCollaboratorsResponseDTO {
  @ApiProperty({ type: [CollaboratorDTO] })
  collaborators: CollaboratorDTO[];
}

export class InvitationRepositoryDTO {
  @ApiProperty()
  username: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;
}

export class InvitationDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: InvitationRepositoryDTO })
  repository: InvitationRepositoryDTO;

  @ApiProperty(roleProperty)
  role: CollaboratorRole;

  @ApiProperty({ type: String, nullable: true })
  invitedByUsername: string | null;

  @ApiProperty()
  invitedAt: string;

  @ApiProperty()
  expiresAt: string;
}

export class ListInvitationsResponseDTO {
  @ApiProperty({ type: [InvitationDTO] })
  invitations: InvitationDTO[];
}

export class RepositoryTeamDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  memberCount: number;

  @ApiProperty({
    ...roleProperty,
    nullable: true,
    description: 'Null when the team has no access to this repository.',
  })
  role: CollaboratorRole | null;
}

export class ListRepositoryTeamsResponseDTO {
  @ApiProperty({ type: [RepositoryTeamDTO] })
  teams: RepositoryTeamDTO[];
}

export class SetTeamRoleRequestDTO {
  @ApiProperty(roleProperty)
  @IsIn(schema.repositoryRole.enumValues)
  role: CollaboratorRole;
}
