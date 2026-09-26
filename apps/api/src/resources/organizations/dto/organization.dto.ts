import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import type { CollaboratorRole } from '../../../lib/git/repository-access/repository-access.js';

import {
  type OrganizationRole,
  organizationRoleHierarchy,
} from '@ghost/permissions';

export class OrganizationSummaryDTO {
  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  logo: string | null;
}

export class MyOrganizationDTO extends OrganizationSummaryDTO {
  @ApiProperty({
    enumName: 'OrganizationRole',
    enum: organizationRoleHierarchy,
    nullable: true,
    description:
      'Highest built-in role held; null when only custom roles are held.',
  })
  viewerRole: OrganizationRole | null;

  @ApiProperty({
    description:
      'Whether the organization lets the viewer create repositories in it, of at least one visibility.',
  })
  canCreateRepositories: boolean;
}

export class ListMyOrganizationsResponseDTO {
  @ApiProperty({ type: [MyOrganizationDTO] })
  organizations: MyOrganizationDTO[];
}

export class ListOrganizationsResponseDTO {
  @ApiProperty({ type: [OrganizationSummaryDTO] })
  organizations: OrganizationSummaryDTO[];
}

export class OrganizationMemberDTO {
  @ApiProperty()
  username: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  image: string | null;

  @ApiProperty({
    description:
      'Whether the member shows their membership outside the organization.',
  })
  public: boolean;
}

export class PinnedRepositoryDTO {
  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  visibility: (typeof schema.repositoryVisiblity.enumValues)[number];
}

export class OrganizationProfileDTO extends OrganizationSummaryDTO {
  @ApiProperty()
  createdAt: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  website: string | null;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;

  @ApiProperty({ description: 'Public repositories only.' })
  repositoryCount: number;

  @ApiProperty({
    type: [OrganizationMemberDTO],
    description:
      'Every member for a member; only public members for anyone else.',
  })
  members: OrganizationMemberDTO[];

  @ApiProperty({
    type: [PinnedRepositoryDTO],
    description:
      'In pinned order, limited to repositories the viewer can read.',
  })
  pinned: PinnedRepositoryDTO[];

  @ApiProperty({
    enumName: 'OrganizationRole',
    enum: organizationRoleHierarchy,
    nullable: true,
    description:
      "The viewer's role in the organization; null for anyone outside it.",
  })
  viewerRole: OrganizationRole | null;
}

export class InviteByUsernameRequestDTO {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    enumName: 'OrganizationRole',
    enum: organizationRoleHierarchy,
  })
  @IsIn(organizationRoleHierarchy)
  role: OrganizationRole;
}

export class ReceivedOrganizationInvitationDTO {
  @ApiProperty()
  id: string;

  @ApiProperty({ type: OrganizationSummaryDTO })
  organization: OrganizationSummaryDTO;

  @ApiProperty({ type: String, nullable: true })
  role: string | null;

  @ApiProperty({ type: String, nullable: true })
  invitedByUsername: string | null;

  @ApiProperty()
  expiresAt: string;
}

export class ListReceivedOrganizationInvitationsResponseDTO {
  @ApiProperty({ type: [ReceivedOrganizationInvitationDTO] })
  invitations: ReceivedOrganizationInvitationDTO[];
}

const repositoryRoleProperty = {
  enumName: 'RepositoryRole',
  enum: schema.repositoryRole.enumValues,
};

export class OrganizationSettingsDTO {
  @ApiProperty({
    ...repositoryRoleProperty,
    nullable: true,
    description:
      "Every member's role on every repository; null grants members nothing beyond their teams and collaborations.",
  })
  basePermission: CollaboratorRole | null;

  @ApiProperty()
  membersCanCreatePublicRepositories: boolean;

  @ApiProperty()
  membersCanCreatePrivateRepositories: boolean;

  @ApiProperty({
    description: 'Whether its private repositories may be forked.',
  })
  allowPrivateForks: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Recorded as the default branch of each new repository.',
  })
  defaultBranch: string | null;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  website: string | null;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ type: String, nullable: true })
  email: string | null;
}

/** Omitted fields are left as they are; null clears a field. */
export class UpdateOrganizationSettingsDTO {
  @ApiPropertyOptional({ ...repositoryRoleProperty, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsIn(schema.repositoryRole.enumValues)
  @IsOptional()
  basePermission?: CollaboratorRole | null;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  membersCanCreatePublicRepositories?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  membersCanCreatePrivateRepositories?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  allowPrivateForks?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(255)
  @IsOptional()
  defaultBranch?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(350)
  @IsOptional()
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ require_protocol: true })
  @IsOptional()
  website?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  location?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsEmail()
  @IsOptional()
  email?: string | null;
}

export class SetPinnedRepositoriesDTO {
  @ApiProperty({
    type: [String],
    description: "Slugs of the organization's repositories, in display order.",
  })
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  repositories: string[];
}

export class OutsideCollaboratorRepositoryDTO {
  @ApiProperty()
  slug: string;

  @ApiProperty(repositoryRoleProperty)
  role: CollaboratorRole;

  @ApiProperty({ description: 'Invited and not yet accepted.' })
  pending: boolean;
}

export class OutsideCollaboratorDTO {
  @ApiProperty()
  username: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  image: string | null;

  @ApiProperty({ type: [OutsideCollaboratorRepositoryDTO] })
  repositories: OutsideCollaboratorRepositoryDTO[];
}

export class ListOutsideCollaboratorsResponseDTO {
  @ApiProperty({ type: [OutsideCollaboratorDTO] })
  collaborators: OutsideCollaboratorDTO[];
}

export class OrganizationTeamSummaryDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'The team in URLs and `@org/team` mentions.' })
  slug: string;

  @ApiProperty()
  memberCount: number;

  @ApiProperty()
  repositoryCount: number;
}

export class ListOrganizationTeamsResponseDTO {
  @ApiProperty({ type: [OrganizationTeamSummaryDTO] })
  teams: OrganizationTeamSummaryDTO[];
}

export class TeamMemberDTO {
  @ApiProperty()
  username: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  image: string | null;

  @ApiProperty()
  maintainer: boolean;
}

export class TeamRepositoryDTO {
  @ApiProperty()
  slug: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    enumName: 'RepositoryVisibility',
    enum: schema.repositoryVisiblity.enumValues,
  })
  visibility: (typeof schema.repositoryVisiblity.enumValues)[number];

  @ApiProperty(repositoryRoleProperty)
  role: CollaboratorRole;
}

export class OrganizationTeamDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ type: [TeamMemberDTO] })
  members: TeamMemberDTO[];

  @ApiProperty({ type: [TeamRepositoryDTO] })
  repositories: TeamRepositoryDTO[];

  @ApiProperty({
    description:
      "Whether the viewer may change the team's members: an admin or one of its maintainers.",
  })
  viewerCanManage: boolean;
}
