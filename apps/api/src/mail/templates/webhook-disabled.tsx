import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface WebhookDisabledProps {
  name?: string;
  owner: string;
  url: string;
  reason: string;
  settingsUrl: string;
  appUrl: string;
}

export default function WebhookDisabled({
  name = 'there',
  owner = 'alice/ghost',
  url = 'https://example.com/webhook',
  reason = 'Every delivery failed for three days.',
  settingsUrl = 'http://localhost:3000/alice/ghost/settings/webhooks/whk_1',
  appUrl = 'http://localhost:3000',
}: WebhookDisabledProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading="A webhook was turned off"
      preview={`Ghost stopped sending deliveries to ${url}`}
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>, Ghost turned off the webhook
        on <span style={text.strong}>{owner}</span> that sends to{' '}
        <span style={text.strong}>{url}</span>. {reason}
      </Text>
      <ActionButton href={settingsUrl}>Review the webhook</ActionButton>
      <LinkFallback href={settingsUrl} />
      <Text style={text.muted}>
        The delivery log shows what the endpoint answered. Once it is fixed,
        turn the webhook back on and redeliver anything it missed.
      </Text>
    </EmailLayout>
  );
}
