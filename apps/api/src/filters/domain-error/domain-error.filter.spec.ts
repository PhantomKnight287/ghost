import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

import { DomainError } from '../../domain/errors.js';
import { DomainErrorFilter } from './domain-error.filter.js';

class TeapotError extends DomainError {
  status = 418;
}

class BrokenError extends DomainError {
  status = 500;
}

function host() {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json: vi.fn() }) }),
      getRequest: () => ({ url: '/api/teapot' }),
    }),
  } as unknown as ArgumentsHost;
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

  it('logs a 5xx and leaves a 4xx quiet', () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const filter = new DomainErrorFilter();

    filter.catch(new TeapotError('short and stout'), host());
    expect(error).not.toHaveBeenCalled();

    const broken = new BrokenError('git exited 128');
    filter.catch(broken, host());
    expect(error).toHaveBeenCalledWith(broken);
    error.mockRestore();
  });
});
