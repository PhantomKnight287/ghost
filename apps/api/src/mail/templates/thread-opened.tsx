import { Text } from '@react-email/components';

import { text } from '../components/layout.js';
import {
  kindOf,
  previewThread,
  Quote,
  ThreadEmail,
  type ThreadProps,
} from '../components/thread.js';

interface ThreadOpenedProps extends ThreadProps {
  body: string | null;
}

export default function ThreadOpened({ body, ...thread }: ThreadOpenedProps) {
  return (
    <ThreadEmail
      thread={thread}
      preview={`${thread.actor} opened ${kindOf(thread)} #${thread.number} in ${thread.repository}`}
    >
      <Text style={text.paragraph}>
        <span style={text.strong}>{thread.actor}</span> opened this{' '}
        {kindOf(thread)}.
      </Text>
      {body && <Quote>{body}</Quote>}
    </ThreadEmail>
  );
}

ThreadOpened.PreviewProps = {
  ...previewThread,
  reason: 'watching',
  body: 'The bell should show how many unread notifications are waiting, and link to the inbox.',
} satisfies ThreadOpenedProps;
