import { Request } from 'express';
import { Actor } from '../services/git/repository-access/repository-access.service.js';
import { GitRequestBody } from '../services/git/protocol/git-request-body.js';

export interface GitAuthenticatedBufferedRequest extends Request {
  actor?: Actor;
  gitBody?: GitRequestBody;
}

/** Post-spool request. Only pack routes run GitRawBodyMiddleware, so only they get a body. */
export interface GitPackRequest extends GitAuthenticatedBufferedRequest {
  gitBody: GitRequestBody;
}
