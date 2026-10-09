import type { Type } from '@nestjs/common';
import { Field, Int, ObjectType } from '@nestjs/graphql';

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

export type ConnectionOf<T> = { nodes: T[]; pageInfo: PageInfo; totalCount: number };

/** GitHub's `<Name>Connection`. Edges are left out until a client asks for them; gh reads `nodes`. */
export function Connection<T>(node: Type<T>, name: string) {
  @ObjectType(`${name}Connection`)
  class ConnectionType implements ConnectionOf<T> {
    @Field(() => [node], { nullable: 'itemsAndList' })
    nodes: T[];

    @Field(() => PageInfo)
    pageInfo: PageInfo;

    @Field(() => Int)
    totalCount: number;
  }
  return ConnectionType;
}

/** One page of a list that is already fully in memory, such as an issue's labels. `first`/`last` slice it as GitHub does; `after` is an offset cursor this function hands out as `endCursor`. */
export function sliceConnection<T>(items: T[], { first, last, after }: { first?: number | null; last?: number | null; after?: string | null }): ConnectionOf<T> {
  // The cursor and the page sizes come from the client, and a negative one would slice from the end.
  const start = Math.max(0, Math.trunc(Number(after ? Buffer.from(after, 'base64url').toString() : 0)) || 0);
  const rest = items.slice(start);
  const nodes = last != null ? rest.slice(rest.length - Math.max(0, last)) : rest.slice(0, Math.max(0, first ?? rest.length));
  const end = last != null ? items.length : start + nodes.length;
  return {
    nodes,
    totalCount: items.length,
    pageInfo: {
      hasNextPage: end < items.length,
      hasPreviousPage: last != null ? nodes.length < rest.length : start > 0,
      startCursor: null,
      endCursor: nodes.length > 0 ? Buffer.from(String(end)).toString('base64url') : null,
    },
  };
}
