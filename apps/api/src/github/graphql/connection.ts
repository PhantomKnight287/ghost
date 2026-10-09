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

/** One page of a list that is already fully in memory, such as an issue's labels. `first`/`last` slice it as GitHub does. */
export function sliceConnection<T>(items: T[], { first, last }: { first?: number | null; last?: number | null }): ConnectionOf<T> {
  const nodes = last ? items.slice(-last) : items.slice(0, first ?? items.length);
  return {
    nodes,
    totalCount: items.length,
    pageInfo: {
      hasNextPage: !last && nodes.length < items.length,
      hasPreviousPage: !!last && nodes.length < items.length,
      startCursor: null,
      endCursor: null,
    },
  };
}
