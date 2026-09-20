import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface ChangeEmailProps {
  name?: string;
  newEmail: string;
  approveUrl: string;
  appUrl: string;
}

export default function ChangeEmail({
  name = 'there',
  newEmail = 'new@example.com',
  approveUrl = 'https://ghost.example/api/auth/change-email/callback?token=preview',
  appUrl = 'http://localhost:3000',
}: ChangeEmailProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading="Approve your new email address"
      preview="Approve the address change on your Ghost account"
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>, your Ghost account asked to
        move to <span style={text.strong}>{newEmail}</span>. Approve it from
        here and that address becomes the one you sign in with.
      </Text>
      <ActionButton href={approveUrl}>Approve the change</ActionButton>
      <LinkFallback href={approveUrl} />
      <Text style={text.muted}>
        This mail goes to your current address on purpose, so a change can never
        happen behind your back. If this was not you, ignore it and nothing
        changes.
      </Text>
    </EmailLayout>
  );
}
