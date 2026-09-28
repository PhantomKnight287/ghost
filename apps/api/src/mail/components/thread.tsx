import type { schema } from '@ghost/db';
import { Link, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

import { ActionButton, EmailLayout, text } from './layout.js';
import { brand, mono } from './theme.js';

export type NotificationReason =
  (typeof schema.notificationReason.enumValues)[number];

const BECAUSE: Record<NotificationReason, string> = {
  assigned: 'you are assigned',
  mentioned: 'you were mentioned',
  team_mentioned: 'a team you are on was mentioned',
  author: 'you opened it',
  subscribed: 'you are subscribed',
  watching: 'you are watching this repository',
};

/** The thread every notification email is about, and why its reader got it. */
export interface ThreadProps {
  appUrl: string;
  repository: string;
  number: number;
  title: string;
  isPullRequest: boolean;
  /** The thread's page, relative to the app. */
  path: string;
  reason: NotificationReason;
  actor: string;
}

export const previewThread: ThreadProps = {
  appUrl: 'http://localhost:3000',
  repository: 'alice/ghost',
  number: 42,
  title: 'Render notifications in the header',
  isPullRequest: false,
  path: '/alice/ghost/issues/42',
  reason: 'subscribed',
  actor: 'bob',
};

export function kindOf(thread: Pick<ThreadProps, 'isPullRequest'>) {
  return thread.isPullRequest ? 'pull request' : 'issue';
}

export function ThreadEmail({
  thread,
  preview,
  children,
}: {
  thread: ThreadProps;
  preview: string;
  children: ReactNode;
}) {
  const url = `${thread.appUrl}${thread.path}`;
  return (
    <EmailLayout
      appUrl={thread.appUrl}
      heading={thread.title}
      preview={preview}
    >
      <Text style={{ ...text.muted, fontFamily: mono, margin: '-8px 0 16px' }}>
        {thread.repository} #{thread.number}
      </Text>
      {children}
      <ActionButton href={url}>View {kindOf(thread)} on Ghost</ActionButton>
      <Text style={text.muted}>
        You are receiving this because {BECAUSE[thread.reason]}.{' '}
        <Link href={url} style={{ color: brand.muted }}>
          Unsubscribe
        </Link>{' '}
        from the {kindOf(thread)} page.
      </Text>
    </EmailLayout>
  );
}

/** Markdown quoted as written: rendering it would carry the author's HTML into the email. */
export function Quote({ children }: { children: string }) {
  return (
    <Section
      style={{
        backgroundColor: brand.secondary,
        borderLeft: `3px solid ${brand.primary}`,
        borderRadius: '6px',
        margin: '0 0 16px',
        padding: '12px 14px',
      }}
    >
      <Text style={{ ...text.paragraph, margin: 0, whiteSpace: 'pre-wrap' }}>
        {children}
      </Text>
    </Section>
  );
}

export function Pill({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return (
    <span
      style={{
        backgroundColor: color,
        borderRadius: '999px',
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: 600,
        padding: '2px 10px',
      }}
    >
      {children}
    </span>
  );
}
