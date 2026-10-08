import { RequestMethod } from '@nestjs/common';

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
