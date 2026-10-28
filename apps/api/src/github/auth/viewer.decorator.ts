import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import type {
  GithubApp,
  GithubRequest,
  GithubViewer,
} from './github-request.js';

const requestOf = (context: ExecutionContext) =>
  context.getType<string>() === 'graphql'
    ? GqlExecutionContext.create(context).getContext<{ req: GithubRequest }>()
        .req
    : context.switchToHttp().getRequest<GithubRequest>();

export const Viewer = createParamDecorator(
  (_: unknown, context: ExecutionContext): GithubViewer | null =>
    requestOf(context).githubViewer,
);

/** The app an app JWT authenticated; the middleware lets one reach only the app routes. */
export const CallingApp = createParamDecorator(
  (_: unknown, context: ExecutionContext): GithubApp | null =>
    requestOf(context).githubApp,
);
