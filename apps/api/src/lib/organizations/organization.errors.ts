import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class OrganizationNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(slug: string) {
    super(`Organization not found: ${slug}`);
  }
}

export class OrganizationForbiddenError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('The organization does not allow you to do that');
  }
}

/** Better Auth turned an invitation down, for a reason worth passing on as it gave it: already a member, already invited, or no permission. */
export class InvitationRefusedError extends DomainError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class PrivateForkingDisabledError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('This organization does not allow forking its private repositories');
  }
}

export class TeamNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Team not found');
  }
}

export class UserNotInOrganizationError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(username: string) {
    super(`${username} is not a member here`);
  }
}

/** Worded as GitHub words it, so a tool built for GitHub shows its user the same explanation. */
export class OauthAppRestrictedError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor(slug: string) {
    super(
      `Although you appear to have the correct authorization credentials, the \`${slug}\` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.`,
    );
  }
}
