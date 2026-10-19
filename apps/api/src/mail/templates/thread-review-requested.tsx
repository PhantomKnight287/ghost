import { Text } from '@react-email/components';

import { text } from '../components/layout.js';
import {
  previewThread,
  ThreadEmail,
  type ThreadProps,
} from '../components/thread.js';

interface ThreadReviewRequestedProps extends ThreadProps {
  reviewer: string;
}

export default function ThreadReviewRequested({
  reviewer,
  ...thread
}: ThreadReviewRequestedProps) {
  const whom = thread.reason === 'review_requested' ? 'you' : reviewer;
  return (
    <ThreadEmail
      thread={thread}
      preview={`${thread.actor} requested a review from ${whom} on #${thread.number} in ${thread.repository}`}
    >
      <Text style={text.paragraph}>
        <span style={text.strong}>{thread.actor}</span> requested a review from{' '}
        <span style={text.strong}>{whom}</span> on this pull request.
      </Text>
    </ThreadEmail>
  );
}

ThreadReviewRequested.PreviewProps = {
  ...previewThread,
  isPullRequest: true,
  reason: 'review_requested',
  reviewer: 'alice',
} satisfies ThreadReviewRequestedProps;
