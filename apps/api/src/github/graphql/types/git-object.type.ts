import {
  Field,
  GraphQLISODateTime,
  ID,
  InterfaceType,
  ObjectType,
} from '@nestjs/graphql';

import { GitSignatureState } from '../enums.js';
import { GitObjectID, URI } from '../scalars.js';
import { type Kinded, Node } from './node.interface.js';
import { UserNode } from './user.type.js';

const resolveType = (value: Kinded) => value.kind;

@ObjectType('GitActor')
export class GitActorNode {
  @Field(() => String, { nullable: true })
  email: string | null;

  @Field(() => String, { nullable: true })
  name: string | null;
}

@InterfaceType('GitObject', { resolveType })
export abstract class GitObject {
  @Field(() => ID)
  id: string;

  @Field(() => GitObjectID)
  oid: string;

  @Field()
  abbreviatedOid: string;

  @Field(() => URI)
  commitUrl: string;

  @Field(() => URI)
  commitResourcePath: string;
}

@ObjectType('Tag', { implements: () => [Node, GitObject] })
export class TagNode {
  kind = 'Tag';
  repositoryGhostId: string;
  /** What the tag object names, resolved into `target`. */
  targetOid: string;
  targetType: string;
  /** The commit the tag resolves to through any nesting. */
  commitOid: string;

  @Field(() => ID)
  id: string;

  @Field(() => GitObjectID)
  oid: string;

  @Field()
  abbreviatedOid: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  message: string | null;

  @Field(() => GitActorNode, { nullable: true })
  tagger: GitActorNode | null;

  /** The tagged commit's, as on GitHub. */
  @Field(() => URI)
  commitUrl: string;

  @Field(() => URI)
  commitResourcePath: string;
}

@InterfaceType('GitSignature', { resolveType })
export abstract class GitSignature {
  @Field()
  email: string;

  @Field()
  isValid: boolean;

  @Field()
  payload: string;

  @Field()
  signature: string;

  @Field(() => UserNode, { nullable: true })
  signer: UserNode | null;

  @Field(() => GitSignatureState)
  state: GitSignatureState;

  @Field(() => GraphQLISODateTime, { nullable: true })
  verifiedAt: Date | null;

  @Field()
  wasSignedByGitHub: boolean;
}

@ObjectType('GpgSignature', { implements: () => [GitSignature] })
export class GpgSignatureNode extends GitSignature {
  kind = 'GpgSignature';

  @Field(() => String, { nullable: true })
  keyId: string | null;
}

@ObjectType('SshSignature', { implements: () => [GitSignature] })
export class SshSignatureNode extends GitSignature {
  kind = 'SshSignature';

  @Field(() => String, { nullable: true })
  keyFingerprint: string | null;
}
