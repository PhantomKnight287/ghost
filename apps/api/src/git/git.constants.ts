import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

export const GIT_SERVICES = ['git-upload-pack', 'git-receive-pack'] as const;

export type GitServiceName = (typeof GIT_SERVICES)[number];

// this is not written by AI - This is handcrafted slop
export type RouteInfo = Exclude<
  Exclude<
    Exclude<
      Parameters<
        Awaited<ReturnType<typeof NestFactory.create>>['setGlobalPrefix']
      >[1],
      undefined
    >['exclude'],
    undefined
  >[number],
  string
>;

export function isGitServiceName(value: unknown): value is GitServiceName {
  return GIT_SERVICES.includes(value as GitServiceName);
}

export function toGitBinary(service: GitServiceName) {
  return service.replace('git-', '') as 'upload-pack' | 'receive-pack';
}

export const FLUSH_PACKET = '0000';

/**
 * Git's smart-HTTP endpoints. Clients append these paths to the clone URL, so
 * they have to sit at the root rather than behind the `/api` prefix - they are
 * the only routes excluded from it.
 */
export const GIT_PACK_ROUTES = [
  { path: ':username/:repo/git-upload-pack', method: RequestMethod.POST },
  { path: ':username/:repo/git-receive-pack', method: RequestMethod.POST },
];

export const GIT_TRANSPORT_ROUTES = [
  { path: ':username/:repo/info/refs', method: RequestMethod.GET },
  ...GIT_PACK_ROUTES,
];
