import { Text } from '@react-email/components';

import { text } from '../components/layout.js';
import {
  previewThread,
  Quote,
  ThreadEmail,
  type ThreadProps,
} from '../components/thread.js';

interface ThreadCommentProps extends ThreadProps {
  body: string;
  /** The file a review comment is on; null for a comment on the conversation. */
  file: string | null;
}

export default function ThreadComment({
  body,
  file,
  ...thread
}: ThreadCommentProps) {
  return (
    <ThreadEmail
      thread={thread}
      preview={`${thread.actor}: ${body.slice(0, 120)}`}
    >
      <Text style={text.paragraph}>
        <span style={text.strong}>{thread.actor}</span> commented
        {file && (
          <>
            {' '}
            on <span style={text.strong}>{file}</span>
          </>
        )}
        :
      </Text>
      <Quote>{body}</Quote>
    </ThreadEmail>
  );
}

ThreadComment.PreviewProps = {
  ...previewThread,
  reason: 'mentioned',
  body: '@alice this needs a count, not only a dot. What do you think?',
  file: null,
} satisfies ThreadCommentProps;
