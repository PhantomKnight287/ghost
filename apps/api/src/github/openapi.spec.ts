import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type Operation = {
  responses: Record<string, { content?: Record<string, unknown> }>;
};
type Schema = { properties?: Record<string, Record<string, unknown>> };

const openapi: {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
} = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '../../openapi.json'), 'utf8'),
);

const operations = Object.entries(openapi.paths)
  .filter(([route]) => route.startsWith('/api/v3'))
  .flatMap(([route, methods]) =>
    Object.entries(methods).map(
      ([method, operation]) =>
        [`${method.toUpperCase()} ${route}`, operation] as const,
    ),
  );

/** Regenerate openapi.json with `bun run openapi` after changing a GitHub-compatible route. */
describe('GitHub REST v3 in openapi.json', () => {
  it('has operations to check', () => {
    expect(operations.length).toBeGreaterThan(0);
  });

  it.each(operations)(
    '%s declares the body of every answer that has one',
    (_route, operation) => {
      const successes = Object.entries(operation.responses).filter(([status]) =>
        status.startsWith('2'),
      );
      expect(successes.length).toBeGreaterThan(0);
      for (const [status, response] of successes)
        if (status !== '204') expect(response.content, status).toBeDefined();
      expect(operation.responses.default?.content).toBeDefined();
    },
  );

  it("documents the label name's limits and how the colour is stored", () => {
    for (const dto of ['GithubCreateLabelDTO', 'GithubUpdateLabelDTO']) {
      const { properties = {} } = openapi.components.schemas[dto]!;
      const name = properties.name ?? properties.new_name;
      expect(name, dto).toMatchObject({ minLength: 1, maxLength: 50 });
      expect(name?.description, dto).toEqual(expect.any(String));
      expect(properties.color, dto).toMatchObject({
        pattern: expect.any(String),
        description: expect.any(String),
      });
    }
  });

  it('documents the 422 a label clash answers', () => {
    for (const route of [
      'POST /api/v3/repos/{owner}/{repo}/labels',
      'PATCH /api/v3/repos/{owner}/{repo}/labels/{name}',
    ])
      expect(
        operations.find(([key]) => key === route)?.[1].responses['422']
          ?.content,
        route,
      ).toBeDefined();
  });
});
