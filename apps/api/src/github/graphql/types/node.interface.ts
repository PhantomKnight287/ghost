import { Field, ID, InterfaceType } from '@nestjs/graphql';

import { URI } from '../scalars.js';

/** Every node class sets `kind` to its GraphQL type name; it is how interfaces and unions resolve. */
export type Kinded = { kind: string };
const resolveType = (value: Kinded) => value.kind;

@InterfaceType('Node', { resolveType })
export abstract class Node {
  @Field(() => ID)
  id: string;
}

@InterfaceType('UniformResourceLocatable', { resolveType })
export abstract class UniformResourceLocatable {
  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}

@InterfaceType('Actor', { resolveType })
export abstract class Actor {
  @Field(() => URI)
  avatarUrl: string;

  @Field()
  login: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}

@InterfaceType('RepositoryOwner', { resolveType })
export abstract class RepositoryOwner {
  @Field(() => URI)
  avatarUrl: string;

  @Field(() => ID)
  id: string;

  @Field()
  login: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;
}
