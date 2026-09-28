import { Text } from '@react-email/components';

import { text } from '../components/layout.js';
import { brand } from '../components/theme.js';
import {
  Pill,
  previewThread,
  Quote,
  ThreadEmail,
  type ThreadProps,
} from '../components/thread.js';

const VERDICTS = {
  approved: { label: 'Approved', verb: 'approved', color: brand.success },
  changes_requested: {
    label: 'Changes requested',
    verb: 'requested changes on',
    color: brand.danger,
  },
  commented: { label: 'Reviewed', verb: 'reviewed', color: brand.muted },
} as const;

interface ThreadReviewProps extends ThreadProps {
  state: keyof typeof VERDICTS;
  body: string | null;
  /** Line comments submitted with the review. */
  commentCount: number;
}

export default function ThreadReview({
  state,
  body,
  commentCount,
  ...thread
}: ThreadReviewProps) {
  const verdict = VERDICTS[state];
  return (
    <ThreadEmail
      thread={thread}
      preview={`${thread.actor} ${verdict.verb} #${thread.number} in ${thread.repository}`}
    >
      <Text style={text.paragraph}>
        <Pill color={verdict.color}>{verdict.label}</Pill>
      </Text>
      <Text style={text.paragraph}>
        <span style={text.strong}>{thread.actor}</span> {verdict.verb} this pull
        request
        {commentCount > 0
          ? ` and left ${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`
          : ''}
        .
      </Text>
      {body && <Quote>{body}</Quote>}
    </ThreadEmail>
  );
}

ThreadReview.PreviewProps = {
  ...previewThread,
  isPullRequest: true,
  path: '/alice/ghost/pulls/42',
  reason: 'author',
  state: 'changes_requested',
  body: 'Close, but the count overflows past 99.',
  commentCount: 2,
} satisfies ThreadReviewProps;
