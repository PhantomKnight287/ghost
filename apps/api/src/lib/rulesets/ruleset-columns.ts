import { schema } from '@ghost/db';
import { sql } from 'drizzle-orm';

import type { BypassActor, RuleType } from './rulesets.types.js';

/** A ruleset with its rules and bypass actors in one row, so loading a repository's rulesets is one query. */
export const rulesetColumns = {
  id: schema.ruleset.id,
  name: schema.ruleset.name,
  target: schema.ruleset.target,
  enforcement: schema.ruleset.enforcement,
  include: schema.ruleset.include,
  exclude: schema.ruleset.exclude,
  rules: sql<
    { type: RuleType }[]
  >`coalesce((select json_agg(json_build_object('type', ${schema.rulesetRule.type}) order by ${schema.rulesetRule.type}) from ${schema.rulesetRule} where ${schema.rulesetRule.rulesetId} = ${schema.ruleset.id}), '[]')`,
  // json_strip_nulls drops the column the actor's type does not use, as the API shape leaves it out.
  bypassActors: sql<
    BypassActor[]
  >`coalesce((select json_agg(json_strip_nulls(json_build_object('actorType', ${schema.rulesetBypassActor.actorType}, 'role', ${schema.rulesetBypassActor.role}, 'teamId', ${schema.rulesetBypassActor.teamId}, 'bypassMode', ${schema.rulesetBypassActor.bypassMode}))) from ${schema.rulesetBypassActor} where ${schema.rulesetBypassActor.rulesetId} = ${schema.ruleset.id}), '[]')`,
};
