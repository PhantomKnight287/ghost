import type { ArgumentsHost } from '@nestjs/common';
import { vi } from 'vitest';

import { DomainError } from '../../domain/errors.js';
import { DomainErrorFilter } from './domain-error.filter.js';

class TeapotError extends DomainError {
  status = 418;
}

describe('DomainErrorFilter', () => {
  it('answers with the error status and its message', () => {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/teapot' }),
      }),
    } as unknown as ArgumentsHost;

    new DomainErrorFilter().catch(new TeapotError('short and stout'), host);

    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 418,
        message: 'short and stout',
        path: '/api/teapot',
      }),
    );
  });
});
