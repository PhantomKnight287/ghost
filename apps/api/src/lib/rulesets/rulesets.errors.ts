import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';
import type { Violation } from './rulesets.types.js';

/** A write path reached commitPush without judging its exact transitions: a bug in that caller, never the user's doing. */
export class RulesetVerdictRequiredError extends DomainError {
  status: number = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(detail: string) {
    super(`Ref write refused without a ruleset verdict: ${detail}`);
  }
}

export class RulesetViolationError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(readonly violations: Violation[]) {
    super(
      `Repository rule violations found: ${violations.map(({ ref, rulesetName, message }) => `${ref}: ${message} (ruleset "${rulesetName}")`).join('; ')}`,
    );
  }
}

export class RulesetNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor(id: string | number) {
    super(`No ruleset ${id} on this repository`);
  }
}

export class RulesetNameTakenError extends DomainError {
  status: number = HttpStatus.CONFLICT;

  constructor(name: string) {
    super(`A ruleset named "${name}" already exists on this repository`);
  }
}

/** A bypass actor that is well formed but names no one this repository can list. */
export class InvalidBypassActorError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;
}
