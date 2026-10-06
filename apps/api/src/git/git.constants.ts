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

/** The environment that lets git speak protocol v2, whose `ls-refs` sends only the refs a client asks for. Anything but an exact `version=2` keeps git on v0, so a client-supplied value never reaches git's environment. */
export function protocolEnv(requested: unknown): Record<string, string> {
  return requested === 'version=2' ? { GIT_PROTOCOL: 'version=2' } : {};
}

/** Git's smart-HTTP endpoints. Clients append these paths to the clone URL, so they have to sit at the root rather than behind the `/api` prefix - they are the only routes excluded from it. */
export const GIT_PACK_ROUTES = [
  { path: ':username/:repo/git-upload-pack', method: RequestMethod.POST },
  { path: ':username/:repo/git-receive-pack', method: RequestMethod.POST },
];

/** Git LFS's batch API, basic transfer and locking API, which the client finds under the clone URL. */
export const LFS_ROUTES = [
  {
    path: ':username/:repo/info/lfs/objects/batch',
    method: RequestMethod.POST,
  },
  { path: ':username/:repo/info/lfs/objects/:oid', method: RequestMethod.GET },
  { path: ':username/:repo/info/lfs/objects/:oid', method: RequestMethod.PUT },
  { path: ':username/:repo/info/lfs/locks', method: RequestMethod.GET },
  { path: ':username/:repo/info/lfs/locks', method: RequestMethod.POST },
  { path: ':username/:repo/info/lfs/locks/verify', method: RequestMethod.POST },
  {
    path: ':username/:repo/info/lfs/locks/:id/unlock',
    method: RequestMethod.POST,
  },
];

export const GIT_TRANSPORT_ROUTES = [
  { path: ':username/:repo/info/refs', method: RequestMethod.GET },
  ...GIT_PACK_ROUTES,
  ...LFS_ROUTES,
];
