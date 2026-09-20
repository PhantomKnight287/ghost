import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface ResetPasswordProps {
  name?: string;
  resetUrl: string;
  appUrl: string;
}

export default function ResetPassword({
  name = 'there',
  resetUrl = 'https://ghost.example/auth/reset-password?token=preview',
  appUrl = 'http://localhost:3000',
}: ResetPasswordProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading="Reset your password"
      preview="Choose a new password for your Ghost account"
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>, we got a request to reset
        the password on your Ghost account. Pick a new one here.
      </Text>
      <ActionButton href={resetUrl}>Choose a new password</ActionButton>
      <LinkFallback href={resetUrl} />
      <Text style={text.muted}>
        The link works once and expires in 1 hour. If you did not ask for this,
        ignore this email - your password stays as it is.
      </Text>
    </EmailLayout>
  );
}
