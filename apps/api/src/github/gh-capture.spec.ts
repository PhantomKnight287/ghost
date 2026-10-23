import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';

import { githubValidationRules } from '../lib/github/validation.js';

type Capture = {
  command: string;
  requests: { method: string; path: string; body: unknown; status: number }[];
}[];

const root = path.join(import.meta.dirname, '../..');
const fixtures = path.join(root, 'test/fixtures/gh-capture');
const schema = buildSchema(
  readFileSync(path.join(root, 'github.schema.gql'), 'utf8'),
);
const openapi: { paths: Record<string, Record<string, unknown>> } = JSON.parse(
  readFileSync(path.join(root, 'openapi.json'), 'utf8'),
);
const routes = Object.entries(openapi.paths).flatMap(([route, methods]) =>
  Object.keys(methods).map((method) => ({
    method: method.toUpperCase(),
    // Express answers a route with or without a trailing slash; gh asks for `/api/v3/`.
    pattern: new RegExp(`^${route.replace(/\{[^}]+\}/g, '[^/]+')}/?$`),
  })),
);

/** Routes gh calls that Ghost does not serve, and why gh copes without them. */
const UNSERVED: Record<string, string> = {};

const captures = existsSync(fixtures)
  ? readdirSync(fixtures)
      .filter((file) => file.endsWith('.json'))
      .map(
        (file) =>
          [
            file,
            JSON.parse(
              readFileSync(path.join(fixtures, file), 'utf8'),
            ) as Capture,
          ] as const,
      )
  : [];

const requestsIn = (capture: Capture) =>
  capture.flatMap(({ command, requests }) =>
    requests.map((request) => ({ command, ...request })),
  );

const queryOf = (body: unknown) =>
  typeof body === 'object' &&
  body !== null &&
  'query' in body &&
  typeof body.query === 'string'
    ? body.query
    : null;

/** What real gh sent in the gh suite (test/gh-capture.ts), checked against what Ghost serves, so a field or route gh needs and Ghost lacks fails here before it fails a user. */
describe('gh capture', () => {
  it('has captures to check', () => {
    expect(captures.length).toBeGreaterThan(0);
  });

  describe.each(captures)('%s', (_file, capture) => {
    it('asks only for GraphQL that Ghost validates', () => {
      for (const { command, body } of requestsIn(capture).filter(
        (request) => request.path === '/api/graphql',
      )) {
        const query = queryOf(body);
        if (!query)
          throw new Error(`${command}: a GraphQL request without a query`);
        expect(
          validate(schema, parse(query), githubValidationRules).map(
            (error) => error.message,
          ),
          command,
        ).toEqual([]);
      }
    });

    it('calls only REST routes that Ghost serves', () => {
      for (const { command, method, path: route } of requestsIn(capture).filter(
        (request) => /^\/api\/(v3|uploads)\//.test(request.path),
      )) {
        const call = `${method} ${route}`;
        // Express answers HEAD with the GET route, which OpenAPI lists alone.
        const served = method === 'HEAD' ? 'GET' : method;
        expect(
          call in UNSERVED ||
            routes.some(
              (candidate) =>
                candidate.method === served && candidate.pattern.test(route),
            ),
          `${command}: ${call}`,
        ).toBe(true);
      }
    });
  });
});
