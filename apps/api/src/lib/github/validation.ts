import type { ApolloServerPlugin } from '@apollo/server';
import {
  GraphQLError,
  OverlappingFieldsCanBeMergedRule,
  specifiedRules,
  validate,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';

const TYPE_CONFLICT = /return conflicting types/;
const OTHER_CONFLICT =
  /are different fields|differing arguments|differing stream directives/;

/** GitHub accepts one response name with different types in fragments that cannot both apply (gh selects `state` on both Issue and PullRequest); graphql-js refuses it. Every other overlap stays refused. */
const OverlappingFieldsAsOnGitHubRule: ValidationRule = (context) =>
  OverlappingFieldsCanBeMergedRule(
    Object.create(context, {
      reportError: {
        value: (error: GraphQLError) => {
          if (
            TYPE_CONFLICT.test(error.message) &&
            !OTHER_CONFLICT.test(error.message)
          )
            return;
          context.reportError(error);
        },
      },
    }) as ValidationContext,
  );

export const githubValidationRules = specifiedRules.map((rule) =>
  rule === OverlappingFieldsCanBeMergedRule
    ? OverlappingFieldsAsOnGitHubRule
    : rule,
);

/** Validates with githubValidationRules in Apollo's place; Apollo's own validation must be off (`dangerouslyDisableValidation`). Answers the first error with 400, as Apollo's validation does. */
export const githubValidationPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ schema, document }) {
        const [error] = validate(schema, document, githubValidationRules);
        if (error)
          throw new GraphQLError(error.message, {
            nodes: error.nodes,
            extensions: {
              code: 'GRAPHQL_VALIDATION_FAILED',
              http: { status: 400 },
            },
          });
      },
    };
  },
};
