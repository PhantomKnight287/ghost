import { validateHeaderValue } from 'node:http';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { HAUNTINGS, haunt } from './haunting.js';

describe('haunt', () => {
  it('sets every header to a value Node can send, then lets the request through', () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        validateHeaderValue(name, value);
        headers[name] = value;
      },
    } as unknown as Response;
    const next = vi.fn();

    haunt({} as Request, res, next);

    expect(headers['X-Powered-By']).toBe('Ectoplasm');
    expect(HAUNTINGS).toContain(headers['X-Haunted-By']);
    expect(headers['X-Spookiness']).toMatch(/^([0-9]|10)\/10$/);
    expect(next).toHaveBeenCalledOnce();
    for (const line of HAUNTINGS) validateHeaderValue('X-Haunted-By', line);
  });
});
