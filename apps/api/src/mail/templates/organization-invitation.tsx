import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface OrganizationInvitationProps {
  inviter: string;
  organization: string;
  role: string;
  acceptUrl: string;
  appUrl: string;
}

export default function OrganizationInvitation({
  inviter = 'Alice',
  organization = 'Acme',
  role = 'write',
  acceptUrl = 'http://localhost:3000/auth/accept-invitation?invitationId=preview',
  appUrl = 'http://localhost:3000',
}: OrganizationInvitationProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading={`Join ${organization}`}
      preview={`${inviter} invited you to join ${organization} on Ghost`}
    >
      <Text style={text.paragraph}>
        <span style={text.strong}>{inviter}</span> invited you to join{' '}
        <span style={text.strong}>{organization}</span> as{' '}
        <span style={text.strong}>{role}</span>. Members get that role on the
        organization's repositories.
      </Text>
      <ActionButton href={acceptUrl}>View invitation</ActionButton>
      <LinkFallback href={acceptUrl} />
      <Text style={text.muted}>
        Nothing changes until you accept. If you do not know {inviter}, decline
        it or ignore this email.
      </Text>
    </EmailLayout>
  );
}
