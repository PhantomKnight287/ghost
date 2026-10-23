import { parseRuleParameters } from './pull-request-parameters.js';
import {
  type StatusCheckRuleParameters,
  StatusCheckRuleParametersZodSchema,
} from './rulesets.types.js';

export function parseStatusCheckParameters(input: unknown) {
  return parseRuleParameters<StatusCheckRuleParameters>(
    StatusCheckRuleParametersZodSchema,
    input,
  );
}
