import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface VerifyAliasProps {
  name?: string;
  verifyUrl: string;
  appUrl: string;
}

export default function VerifyAlias({
  name = 'there',
  verifyUrl = 'https://ghost.example/api/emails/verify?token=preview',
  appUrl = 'http://localhost:3000',
}: VerifyAliasProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading="Add this address to your account"
      preview="Confirm this address so Ghost can recognise your commits from it"
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>, this address was added to
        your Ghost account. Confirm it and you can sign in with it, and commits
        you push from it count as yours.
      </Text>
      <ActionButton href={verifyUrl}>Confirm address</ActionButton>
      <LinkFallback href={verifyUrl} />
      <Text style={text.muted}>
        The link works once and expires in 1 hour. If this was not you, ignore
        this email — the address stays unverified and unused.
      </Text>
    </EmailLayout>
  );
}
