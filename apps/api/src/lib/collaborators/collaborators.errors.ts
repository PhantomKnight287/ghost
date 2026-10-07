import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class CannotInviteOwnerError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('The owner already has every permission on this repository');
  }
}

export class CollaboratorNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(username: string) {
    super(`${username} is not a collaborator on this repository`);
  }
}

export class InvitationNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Invitation not found');
  }
}

export class RepositoryNotInOrganizationError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('Only an organization’s repositories can be shared with teams');
  }
}

export class TeamNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Team not found in this organization');
  }
}
