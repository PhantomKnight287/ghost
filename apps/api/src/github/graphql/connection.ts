import type { Type } from '@nestjs/common';
import { Field, Int, ObjectType } from '@nestjs/graphql';

import { keysetCursor } from '../../lib/db/keyset.js';

@ObjectType('PageInfo')
export class PageInfo {
  @Field(() => String, { nullable: true })
  endCursor: string | null;

  @Field()
  hasNextPage: boolean;

  @Field()
  hasPreviousPage: boolean;

  @Field(() => String, { nullable: true })
  startCursor: string | null;
}

export type ConnectionOf<T> = {
  nodes: T[];
  edges?: { cursor: string; node: T }[];
  pageInfo: PageInfo;
  totalCount: number;
};

/** GitHub's `<Name>Edge`. */
export function Edge<T>(node: Type<T> | object, name: string) {
  @ObjectType(`${name}Edge`)
  class EdgeType {
    @Field()
    cursor: string;

    @Field(() => node, { nullable: true })
    node: T;
  }
  return EdgeType;
}

/** GitHub's `<Name>Connection`. Edges are left out unless `edges` is set, for the connections gh reads them on; elsewhere gh reads `nodes`. */
export function Connection<T>(
  node: Type<T> | object,
  name: string,
  { edges }: { edges?: boolean } = {},
) {
  @ObjectType(`${name}Connection`)
  class ConnectionType implements ConnectionOf<T> {
    @Field(() => [node], { nullable: 'itemsAndList' })
    nodes: T[];

    @Field(() => PageInfo)
    pageInfo: PageInfo;

    @Field(() => Int)
    totalCount: number;
  }
  if (edges) {
    const EdgeType = Edge(node, name);
    Field(() => [EdgeType], { nullable: 'itemsAndList' })(
      ConnectionType.prototype,
      'edges',
    );
  }
  return ConnectionType;
}

/** An offset as the opaque cursor GitHub's connections hand out. */
export function offsetCursor(offset: number) {
  return Buffer.from(String(offset)).toString('base64url');
}

/** The offset an `offsetCursor` stands for; 0 for none or for one that is not a count. */
export function cursorOffset(after: string | null | undefined) {
  // The cursor comes from the client, and a negative one would slice from the end.
  return Math.max(
    0,
    Math.trunc(
      Number(after ? Buffer.from(after, 'base64url').toString() : 0),
    ) || 0,
  );
}

/** One page of a list that is already fully in memory, such as an issue's labels. `first`/`last` slice it as GitHub does; `after` is an offset cursor this function hands out as `endCursor`. */
export function sliceConnection<T>(
  items: T[],
  {
    first,
    last,
    after,
  }: { first?: number | null; last?: number | null; after?: string | null },
): ConnectionOf<T> {
  const start = cursorOffset(after);
  const rest = items.slice(start);
  const nodes =
    last != null
      ? rest.slice(rest.length - Math.max(0, last))
      : rest.slice(0, Math.max(0, first ?? rest.length));
  const end = last != null ? items.length : start + nodes.length;
  return {
    nodes,
    edges: nodes.map((node, index) => ({
      node,
      cursor: offsetCursor(end - nodes.length + index + 1),
    })),
    totalCount: items.length,
    pageInfo: {
      hasNextPage: end < items.length,
      hasPreviousPage: last != null ? nodes.length < rest.length : start > 0,
      startCursor: null,
      endCursor: nodes.length > 0 ? offsetCursor(end) : null,
    },
  };
}

/** The cursor that resumes an issue list after this issue, as IssuesService.getIssues pages it by `sort`. */
export function issueCursor(
  issue: { id: string; createdAt: string; updatedAt: string },
  sort: 'created' | 'updated',
) {
  return keysetCursor([
    sort === 'updated' ? issue.updatedAt : issue.createdAt,
    issue.id,
  ]);
}
