import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface VerifyEmailProps {
  name?: string;
  verifyUrl: string;
  appUrl: string;
}

export default function VerifyEmail({
  name = 'there',
  verifyUrl = 'https://ghost.example/api/auth/verify-email?token=preview',
  appUrl = 'http://localhost:3000',
}: VerifyEmailProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading="Confirm your email address"
      preview="One click to activate your Ghost account"
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>, your Ghost account is ready.
        Confirm this address and you can push, open issues and review pull
        requests.
      </Text>
      <ActionButton href={verifyUrl}>Verify email</ActionButton>
      <LinkFallback href={verifyUrl} />
      <Text style={text.muted}>
        Did not sign up? Ignore this email and no account is created.
      </Text>
    </EmailLayout>
  );
}
