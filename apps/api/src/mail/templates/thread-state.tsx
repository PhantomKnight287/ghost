import { Text } from '@react-email/components';

import { text } from '../components/layout.js';
import { brand } from '../components/theme.js';
import {
  kindOf,
  Pill,
  previewThread,
  ThreadEmail,
  type ThreadProps,
} from '../components/thread.js';

const STATES = {
  closed: { label: 'Closed', color: brand.danger },
  reopened: { label: 'Reopened', color: brand.success },
  merged: { label: 'Merged', color: brand.primary },
} as const;

interface ThreadStateProps extends ThreadProps {
  state: keyof typeof STATES;
}

export default function ThreadState({ state, ...thread }: ThreadStateProps) {
  return (
    <ThreadEmail
      thread={thread}
      preview={`${thread.actor} ${state} #${thread.number} in ${thread.repository}`}
    >
      <Text style={text.paragraph}>
        <Pill color={STATES[state].color}>{STATES[state].label}</Pill>
      </Text>
      <Text style={text.paragraph}>
        <span style={text.strong}>{thread.actor}</span> {state} this{' '}
        {kindOf(thread)}.
      </Text>
    </ThreadEmail>
  );
}

ThreadState.PreviewProps = {
  ...previewThread,
  isPullRequest: true,
  path: '/alice/ghost/pulls/42',
  reason: 'author',
  state: 'merged',
} satisfies ThreadStateProps;
