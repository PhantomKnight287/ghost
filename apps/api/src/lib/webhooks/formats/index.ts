import type { WebhookBody, WebhookPing } from '../webhooks.js';
import { discord } from './discord.js';
import { googleChat } from './google-chat.js';
import { messageOf, type WebhookMessage } from './message.js';
import { slack } from './slack.js';
import { teams } from './teams.js';

/** Who a chat message is from, where the service lets a webhook say. */
export type WebhookSender = { name: string; iconUrl: string };

/** A chat service whose incoming webhooks want their own JSON instead of Ghost's. */
export type WebhookFormat = {
  matches: (url: URL) => boolean;
  render: (message: WebhookMessage, sender: WebhookSender) => unknown;
};

/** To support another service, add a file beside these and list it here; to stop, remove it. An endpoint no format matches gets Ghost's own JSON. */
const formats: WebhookFormat[] = [slack, discord, googleChat, teams];

/** The exact bytes `url` receives for `body`. */
export function renderWebhookBody(
  url: string,
  body: WebhookBody | WebhookPing,
  sender: WebhookSender,
) {
  const parsed = URL.parse(url);
  const format =
    parsed && formats.find((candidate) => candidate.matches(parsed));
  return JSON.stringify(format ? format.render(messageOf(body), sender) : body);
}
