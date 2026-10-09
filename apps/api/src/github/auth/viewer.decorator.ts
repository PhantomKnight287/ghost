import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import type { GithubRequest, GithubViewer } from './github-request.js';

export const Viewer = createParamDecorator(
  (_: unknown, context: ExecutionContext): GithubViewer | null => {
    const req =
      context.getType<string>() === 'graphql'
        ? GqlExecutionContext.create(context).getContext<{ req: GithubRequest }>().req
        : context.switchToHttp().getRequest<GithubRequest>();
    return req.githubViewer;
  },
);
