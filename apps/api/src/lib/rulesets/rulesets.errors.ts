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

// GitHub's layout, one paragraph per rule; Ghost also names the ruleset, and lists every rule where GitHub stops at the first.
const listed = (violations: Violation[]) =>
  violations
    .map(({ rulesetName, message }) => `${message} (ruleset "${rulesetName}")`)
    .join('\n\n');

export class RulesetViolationError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(readonly violations: Violation[]) {
    super(`Repository rule violations found\n\n${listed(violations)}\n\n`);
  }
}

/** GitHub answers a merge method the rules leave out on its own, before any other requirement. */
export class MergeMethodNotAllowedError extends DomainError {
  status: number = HttpStatus.METHOD_NOT_ALLOWED;
}

/** Every unmet requirement is one the merger may bypass, but they did not say they meant to. */
export class RulesetBypassRequiredError extends DomainError {
  status: number = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(readonly bypassed: Violation[]) {
    super(
      `Repository rule violations found, which you can bypass by merging with bypassRules\n\n${listed(bypassed)}\n\n`,
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

/** Parameters a rule does not take, or that are out of range. GitHub's routes answer it as a 422. */
export class InvalidRuleParametersError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor(type: string, detail: string) {
    super(`Invalid parameters for the ${type} rule: ${detail}`);
  }
}

/** Ghost's own merges and suggestions must verify under the rule, which they only do while it can sign them. */
export class RequiredSignaturesNeedKeyError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;

  constructor() {
    super('Required signatures need a commit signing key on this server');
  }
}
