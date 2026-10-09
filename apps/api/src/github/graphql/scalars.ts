import { GraphQLScalarType, Kind } from 'graphql';

function stringScalar(name: string, description: string) {
  return new GraphQLScalarType({
    name,
    description,
    serialize: (value) => String(value),
    parseValue: (value) => String(value),
    parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
  });
}

export const URI = stringScalar('URI', 'An RFC 3986, RFC 3987, and RFC 6570 (level 4) compliant URI string.');
export const HTML = stringScalar('HTML', 'A string containing HTML code.');
export const GitObjectID = stringScalar('GitObjectID', 'A Git object ID.');
export const GitSSHRemote = stringScalar('GitSSHRemote', 'Git SSH string');
