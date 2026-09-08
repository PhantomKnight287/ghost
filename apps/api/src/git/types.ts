import { Request } from 'express';
import {
  Actor,
  Repository,
} from '../services/git/repository-access/repository-access.service.js';
import { GitRequestBody } from '../services/git/protocol/git-request-body.js';

export interface GitAuthenticatedBufferedRequest extends Request {
  actor?: Actor;
  repository?: Repository;
  gitBody?: GitRequestBody;
}

/** Post-authorization request. Every git transport route runs the auth middleware. */
export interface GitAuthorizedRequest extends GitAuthenticatedBufferedRequest {
  repository: Repository;
}

/** Post-spool request. Only pack routes run GitRawBodyMiddleware, so only they get a body. */
export interface GitPackRequest extends GitAuthenticatedBufferedRequest {
  gitBody: GitRequestBody;
}
