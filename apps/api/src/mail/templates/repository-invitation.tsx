import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface RepositoryInvitationProps {
  name?: string;
  inviter: string;
  repository: string;
  role: string;
  invitationsUrl: string;
  appUrl: string;
}

export default function RepositoryInvitation({
  name = 'there',
  inviter = 'alice',
  repository = 'alice/ghost',
  role = 'write',
  invitationsUrl = 'http://localhost:3000/dashboard',
  appUrl = 'http://localhost:3000',
}: RepositoryInvitationProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading={`Join ${repository}`}
      preview={`${inviter} invited you to collaborate on ${repository}`}
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>,{' '}
        <span style={text.strong}>{inviter}</span> invited you to collaborate on{' '}
        <span style={text.strong}>{repository}</span> with{' '}
        <span style={text.strong}>{role}</span> access.
      </Text>
      <ActionButton href={invitationsUrl}>View invitation</ActionButton>
      <LinkFallback href={invitationsUrl} />
      <Text style={text.muted}>
        Nothing changes until you accept. If you do not know {inviter}, decline
        it or ignore this email.
      </Text>
    </EmailLayout>
  );
}
