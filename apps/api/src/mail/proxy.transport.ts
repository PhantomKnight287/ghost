import type { Transport } from 'nodemailer';
import type MailMessage from 'nodemailer/lib/mailer/mail-message.js';

function addresses(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(addresses).join(', ');
  if (value && typeof value === 'object' && 'address' in value) {
    return (value as { address: string }).address;
  }
  return '';
}

/**
 * Nodemailer transport that POSTs the rendered mail to an HTTP relay instead of
 * talking SMTP, for deployments where outbound port 587 is closed.
 */
export function proxyTransport(url: string, secret?: string): Transport {
  return {
    name: 'email-proxy',
    version: '1.0.0',
    send(mail: MailMessage, callback) {
      const { to, from, subject, html, text } = mail.data;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: addresses(to),
          from: addresses(from),
          subject,
          htmlBody: html,
          textBody: text,
          secret,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(
              `Email proxy responded with ${res.status}: ${await res.text()}`,
            );
          }
          callback(null, {
            envelope: mail.message!.getEnvelope(),
            messageId: mail.message!.messageId(),
          });
        })
        .catch((error: Error) => callback(error, undefined));
    },
  };
}
