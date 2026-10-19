import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bufferBody } from '../../../lib/git/protocol/git-request-body.js';
import { NonFastForwardError } from '../../../lib/git/wal/wal.errors.js';
import {
  emptyIndex,
  type RefTransition,
  ZERO_OID,
} from '../../../lib/git/wal/wal.types.js';
import {
  RulesetVerdictRequiredError,
  RulesetViolationError,
} from '../../../lib/rulesets/rulesets.errors.js';
import type { Violation } from '../../../lib/rulesets/rulesets.types.js';
import { PushTransactionService } from './push-transaction.service.js';
import { WalStoreService } from './wal-store.service.js';

const oid = (byte: number) => Buffer.alloc(20, byte);
const PACK_OFFSET = 8;
const body = bufferBody(
  Buffer.concat([Buffer.from('00000000'), Buffer.from('PACKDATA')]),
);
const REPO = 'repo_rulesets';
const move: RefTransition = {
  ref: 'refs/heads/main',
  oldOid: oid(0xaa),
  newOid: oid(0xbb),
};
const violation: Violation = {
  ref: 'refs/heads/main',
  rulesetId: 'ruleset_1',
  rulesetName: 'protect main',
  rule: 'non_fast_forward',
  message: 'Cannot force-push to this branch',
};

/** The guarantee that no write path skips rulesets: a user write must carry the verdict for exactly its own transitions, and a clean one. */
describe('PushTransactionService and rulesets', () => {
  let service: PushTransactionService;
  const store = {
    putEntry: vi.fn().mockResolvedValue(undefined),
    readIndex: vi.fn(),
    casIndex: vi.fn().mockResolvedValue(true),
    deleteEntry: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    store.casIndex.mockResolvedValue(true);
    store.readIndex.mockResolvedValue({
      index: {
        ...emptyIndex(),
        seq: 1,
        refs: new Map([['refs/heads/main', oid(0xaa)]]),
      },
      etag: '"one"',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushTransactionService,
        { provide: WalStoreService, useValue: store },
      ],
    }).compile();
    service = module.get(PushTransactionService);
  });

  const commit = (actor: unknown, transitions: RefTransition[] = [move]) =>
    service.commitPush({
      repoId: REPO,
      transitions,
      body,
      packOffset: PACK_OFFSET,
      // Malformed on purpose in some tests.
      actor: actor as never,
    });

  it('commits a user write that carries a clean verdict for its transitions', async () => {
    const result = await commit({
      userId: 'user_1',
      verdict: { transitions: [move], violations: [] },
    });

    expect(result.seq).toBe(2);
    expect(store.casIndex).toHaveBeenCalledTimes(1);
  });

  it('commits a system write without any verdict', async () => {
    await expect(commit('system')).resolves.toMatchObject({ seq: 2 });
  });

  it('refuses a write that names no actor, before storing anything', async () => {
    await expect(commit(undefined)).rejects.toBeInstanceOf(
      RulesetVerdictRequiredError,
    );
    expect(store.putEntry).not.toHaveBeenCalled();
    expect(store.casIndex).not.toHaveBeenCalled();
  });

  it('refuses a user write without a verdict, before storing anything', async () => {
    await expect(commit({ userId: 'user_1' })).rejects.toBeInstanceOf(
      RulesetVerdictRequiredError,
    );
    expect(store.putEntry).not.toHaveBeenCalled();
    expect(store.casIndex).not.toHaveBeenCalled();
  });

  it('refuses a user write whose verdict has violations, before storing anything', async () => {
    const error = await commit({
      userId: 'user_1',
      verdict: { transitions: [move], violations: [violation] },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RulesetViolationError);
    expect((error as RulesetViolationError).violations).toEqual([violation]);
    expect(store.putEntry).not.toHaveBeenCalled();
    expect(store.casIndex).not.toHaveBeenCalled();
  });

  it('refuses a verdict reached for other transitions', async () => {
    const elsewhere = { ...move, ref: 'refs/heads/dev' };
    const otherTarget = { ...move, newOid: oid(0xcc) };
    const otherBase = { ...move, oldOid: oid(0xdd) };

    for (const judged of [[elsewhere], [otherTarget], [otherBase], []]) {
      await expect(
        commit({
          userId: 'user_1',
          verdict: { transitions: judged, violations: [] },
        }),
      ).rejects.toBeInstanceOf(RulesetVerdictRequiredError);
    }
    // A verdict for more transitions than the write makes covers something else too.
    await expect(
      commit({
        userId: 'user_1',
        verdict: { transitions: [move, elsewhere], violations: [] },
      }),
    ).rejects.toBeInstanceOf(RulesetVerdictRequiredError);
    expect(store.casIndex).not.toHaveBeenCalled();
  });

  it('fails the commit when the ref moved after the verdict was reached', async () => {
    store.readIndex.mockResolvedValue({
      index: {
        ...emptyIndex(),
        seq: 3,
        refs: new Map([['refs/heads/main', oid(0xee)]]),
      },
      etag: '"three"',
    });

    await expect(
      commit({
        userId: 'user_1',
        verdict: { transitions: [move], violations: [] },
      }),
    ).rejects.toBeInstanceOf(NonFastForwardError);
    expect(store.casIndex).not.toHaveBeenCalled();
  });

  it('records the acting user as the pusher', async () => {
    await commit({
      userId: 'user_1',
      verdict: { transitions: [move], violations: [] },
    });
    const [, , header] = store.putEntry.mock.calls[0] as [
      string,
      string,
      Buffer,
    ];
    expect(header.includes(Buffer.from('user_1'))).toBe(true);
  });

  it('accepts a deletion judged with the same transition', async () => {
    const deletion = { ...move, newOid: ZERO_OID };
    await expect(
      commit(
        {
          userId: 'user_1',
          verdict: { transitions: [deletion], violations: [] },
        },
        [deletion],
      ),
    ).resolves.toMatchObject({ seq: 2 });
  });
});
