import { Text } from '@react-email/components';

import { text } from '../components/layout.js';
import {
  kindOf,
  previewThread,
  ThreadEmail,
  type ThreadProps,
} from '../components/thread.js';

interface ThreadAssignedProps extends ThreadProps {
  assignee: string;
}

export default function ThreadAssigned({
  assignee,
  ...thread
}: ThreadAssignedProps) {
  const whom = thread.reason === 'assigned' ? 'you' : assignee;
  return (
    <ThreadEmail
      thread={thread}
      preview={`${thread.actor} assigned ${whom} to #${thread.number} in ${thread.repository}`}
    >
      <Text style={text.paragraph}>
        <span style={text.strong}>{thread.actor}</span> assigned{' '}
        <span style={text.strong}>{whom}</span> to this {kindOf(thread)}.
      </Text>
    </ThreadEmail>
  );
}

ThreadAssigned.PreviewProps = {
  ...previewThread,
  reason: 'assigned',
  assignee: 'alice',
} satisfies ThreadAssignedProps;
