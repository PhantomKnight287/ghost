import { describe, expect, it } from 'vitest';

import { toOrganizationNode, toUserNode } from './nodes.js';

const origins = { api: 'https://api.ghost.test', web: 'https://ghost.test', sshHost: 'ghost.test:1031' };

describe('toUserNode', () => {
  it('builds GitHub user fields from a Ghost user row', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const node = toUserNode({ id: 'u1', username: 'ada', name: 'Ada', image: null, createdAt: created } as never, origins);
    expect(node).toMatchObject({ kind: 'User', ghostId: 'u1', login: 'ada', name: 'Ada', avatarUrl: '', resourcePath: '/ada', url: 'https://ghost.test/ada', databaseId: null, createdAt: created });
    expect(node.id).toMatch(/^U_/);
  });
});

describe('toOrganizationNode', () => {
  it('uses the slug as the login', () => {
    const node = toOrganizationNode({ id: 'o1', slug: 'acme', name: 'Acme', logo: 'https://x/logo.png' } as never, origins);
    expect(node).toMatchObject({ kind: 'Organization', login: 'acme', avatarUrl: 'https://x/logo.png', url: 'https://ghost.test/acme' });
    expect(node.id).toMatch(/^O_/);
  });
});
