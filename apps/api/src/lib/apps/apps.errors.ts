import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class AppNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('App not found');
  }
}

export class AppNameTakenError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app already uses that name');
  }
}

export class InvalidAppPermissionsError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(message: string) {
    super(message);
  }
}

export class TooManyPrivateKeysError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app can hold at most 20 private keys');
  }
}

export class PrivateKeyNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Private key not found');
  }
}

export class AppNameUnusableError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app name needs at least one letter or digit');
  }
}

export class AppSlugReservedError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('That app slug is reserved');
  }
}

/** GitHub's messages, word for word, for a JWT it cannot read, check or match to an app, and for its two time limits. */
export const JWT_UNDECODABLE = 'A JSON web token could not be decoded';
export const JWT_EXPIRED =
  "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires";
export const JWT_TOO_LONG =
  "'Expiration time' claim ('exp') is too far in the future";

export class AppJwtError extends DomainError {
  status: number = HttpStatus.UNAUTHORIZED;

  constructor(message: string = JWT_UNDECODABLE) {
    super(message);
  }
}

export class InstallationNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Installation not found');
  }
}

export class AlreadyInstalledError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('This app is already installed on that account');
  }
}

export class InstallationRepositoryError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('Pick repositories the account owns');
  }
}

export class InstallationSuspendedError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('This installation has been suspended');
  }
}

export class InstallationPermissionsError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('The permissions requested are not granted to this installation.');
  }
}

export class InstallationRepositoriesError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super(
      'There is at least one repository that does not exist or is not accessible to the parent installation.',
    );
  }
}

/** GitHub's answer to an app caller on a route its credential cannot use. */
export class IntegrationForbiddenError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super('Resource not accessible by integration');
  }
}

export class AppWebhookSecretRequiredError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('A webhook URL needs a secret');
  }
}

export class TooManyClientSecretsError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super('An app can have at most 20 client secrets');
  }
}

export class ClientSecretNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Not Found');
  }
}

export class OauthOnInstallNeedsCallbackError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor() {
    super(
      'Add a callback URL before asking for user authorization during installation',
    );
  }
}

export class UserToServerTokenRequiredError extends DomainError {
  status: number = HttpStatus.FORBIDDEN;

  constructor() {
    super(
      'You must authenticate with an access token authorized to a GitHub App in order to list installations',
    );
  }
}
