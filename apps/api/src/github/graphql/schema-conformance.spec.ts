import { readFileSync } from 'node:fs';
import path from 'node:path';
import { schema as github } from '@octokit/graphql-schema';
import {
  buildSchema,
  type GraphQLNamedType,
  type GraphQLType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isUnionType,
} from 'graphql';
import { describe, expect, it } from 'vitest';

const ours = buildSchema(readFileSync(path.join(import.meta.dirname, '../../../github.schema.gql'), 'utf8'));
const theirs = buildSchema(github.idl);

/** `[User!]!` -> `L!(N!(User))`: shape and name, so two types compare as strings. */
function shape(type: GraphQLType): string {
  if (isNonNullType(type)) return `${shape(type.ofType)}!`;
  if (isListType(type)) return `[${shape(type.ofType)}]`;
  return type.name;
}

/** Ours may be stricter than GitHub's output type (non-null where GitHub allows null) but never looser, and never a different name or list shape. */
function outputConforms(ourType: GraphQLType, theirType: GraphQLType): boolean {
  if (isNonNullType(theirType)) return isNonNullType(ourType) && outputConforms(ourType.ofType, theirType.ofType);
  if (isNonNullType(ourType)) return outputConforms(ourType.ofType, theirType);
  if (isListType(theirType)) return isListType(ourType) && outputConforms(ourType.ofType, theirType.ofType);
  return !isListType(ourType) && (ourType as GraphQLNamedType).name === (theirType as GraphQLNamedType).name;
}

const ourTypes = Object.values(ours.getTypeMap()).filter((type) => !type.name.startsWith('__') && !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(type.name));

describe('github.schema.gql conforms to GitHub', () => {
  it.each(ourTypes.map((type) => [type.name, type] as const))('%s', (name, type) => {
    const theirType = theirs.getType(name);
    expect(theirType, `GitHub has no type ${name}`).toBeDefined();
    expect(theirType!.constructor.name, `${name} is a different kind of type on GitHub`).toBe(type.constructor.name);
    const problems: string[] = [];

    if ((isObjectType(type) || isInterfaceType(type)) && (isObjectType(theirType) || isInterfaceType(theirType))) {
      const theirFields = theirType.getFields();
      for (const field of Object.values(type.getFields())) {
        const theirField = theirFields[field.name];
        if (!theirField) {
          problems.push(`${name}.${field.name} does not exist on GitHub`);
          continue;
        }
        if (!outputConforms(field.type, theirField.type)) problems.push(`${name}.${field.name}: ours ${shape(field.type)}, GitHub ${shape(theirField.type)}`);
        for (const arg of field.args) {
          const theirArg = theirField.args.find((candidate) => candidate.name === arg.name);
          if (!theirArg) problems.push(`${name}.${field.name}(${arg.name}) does not exist on GitHub`);
          else if (shape(arg.type) !== shape(theirArg.type) && !(isNonNullType(theirArg.type) === false && shape(arg.type) === shape(theirArg.type).replace(/!$/, ''))) problems.push(`${name}.${field.name}(${arg.name}): ours ${shape(arg.type)}, GitHub ${shape(theirArg.type)}`);
        }
      }
      const theirInterfaces = theirType.getInterfaces().map((i) => i.name);
      for (const implemented of type.getInterfaces()) if (!theirInterfaces.includes(implemented.name)) problems.push(`${name} implements ${implemented.name}, GitHub's does not`);
    }

    if (isEnumType(type) && isEnumType(theirType)) {
      const theirValues = theirType.getValues().map((value) => value.name);
      for (const value of type.getValues()) if (!theirValues.includes(value.name)) problems.push(`${name}.${value.name} is not a GitHub value`);
    }

    if (isUnionType(type) && isUnionType(theirType)) {
      const theirMembers = theirType.getTypes().map((member) => member.name);
      for (const member of type.getTypes()) if (!theirMembers.includes(member.name)) problems.push(`${name} includes ${member.name}, GitHub's does not`);
    }

    if (isInputObjectType(type) && isInputObjectType(theirType)) {
      const theirFields = theirType.getFields();
      for (const field of Object.values(type.getFields())) {
        const theirField = theirFields[field.name];
        if (!theirField) problems.push(`${name}.${field.name} does not exist on GitHub`);
        else if (shape(field.type).replace(/!$/, '') !== shape(theirField.type).replace(/!$/, '')) problems.push(`${name}.${field.name}: ours ${shape(field.type)}, GitHub ${shape(theirField.type)}`);
        else if (isNonNullType(field.type) && !isNonNullType(theirField.type)) problems.push(`${name}.${field.name} is required here but optional on GitHub`);
      }
      for (const theirField of Object.values(theirFields)) if (isNonNullType(theirField.type) && theirField.defaultValue === undefined && !type.getFields()[theirField.name]) problems.push(`${name}.${theirField.name} is required on GitHub, so gh sends it, but missing here`);
    }

    expect(problems).toEqual([]);
  });
});
