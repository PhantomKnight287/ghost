import { Text } from '@react-email/components';

import {
  ActionButton,
  EmailLayout,
  LinkFallback,
  text,
} from '../components/layout.js';

interface WebhookDisabledProps {
  name?: string;
  repository: string;
  url: string;
  settingsUrl: string;
  appUrl: string;
}

export default function WebhookDisabled({
  name = 'there',
  repository = 'alice/ghost',
  url = 'https://example.com/webhook',
  settingsUrl = 'http://localhost:3000/alice/ghost/settings/webhooks/whk_1',
  appUrl = 'http://localhost:3000',
}: WebhookDisabledProps) {
  return (
    <EmailLayout
      appUrl={appUrl}
      heading="A webhook was turned off"
      preview={`Deliveries to ${url} kept failing, so Ghost stopped sending them`}
    >
      <Text style={text.paragraph}>
        Hi <span style={text.strong}>{name}</span>, every delivery from{' '}
        <span style={text.strong}>{repository}</span> to{' '}
        <span style={text.strong}>{url}</span> failed for three days, so Ghost
        turned the webhook off.
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
