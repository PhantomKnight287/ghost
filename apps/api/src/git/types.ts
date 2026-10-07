import { Request } from 'express';
import {
  Actor,
  AuthorizedRepository,
} from '../lib/repositories/access/repository-access.js';
import { GitRequestBody } from '../lib/git/protocol/git-request-body.js';

export interface GitAuthenticatedBufferedRequest extends Request {
  actor?: Actor;
  apiKeyId?: string | null;
  repository?: AuthorizedRepository;
  gitBody?: GitRequestBody;
}

/** Post-authorization request. Every git transport route runs the auth middleware. */
export interface GitAuthorizedRequest extends GitAuthenticatedBufferedRequest {
  repository: AuthorizedRepository;
}

/** Post-spool request. Only pack routes run GitRawBodyMiddleware, so only they get a body. */
export interface GitPackRequest extends GitAuthenticatedBufferedRequest {
  gitBody: GitRequestBody;
}
