import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

import { brand, mono, sans } from './theme.js';

export const text = {
  paragraph: {
    fontSize: '14px',
    lineHeight: '22px',
    color: brand.foreground,
    margin: '0 0 16px',
  },
  strong: { fontWeight: 600, color: brand.foreground },
  muted: {
    fontSize: '13px',
    lineHeight: '20px',
    color: brand.muted,
    margin: '0',
  },
} as const;

/** Mirrors the `default` button variant: bg-primary, rounded-lg, text-sm. */
export function ActionButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Section style={{ margin: '20px 0 16px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: brand.primary,
          borderRadius: '10px',
          color: brand.primaryFg,
          display: 'block',
          fontFamily: sans,
          fontSize: '14px',
          fontWeight: 500,
          padding: '10px 16px',
          textAlign: 'center',
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** The raw link, for clients that strip buttons. */
export function LinkFallback({ href }: { href: string }) {
  return (
    <>
      <Text style={{ ...text.muted, fontSize: '12px', margin: '0 0 4px' }}>
        Button not working? Paste this link into your browser:
      </Text>
      <Text
        style={{
          ...text.muted,
          fontFamily: mono,
          fontSize: '12px',
          lineHeight: '19px',
          margin: '0 0 16px',
          wordBreak: 'break-all',
        }}
      >
        <Link href={href} style={{ color: brand.primary }}>
          {href}
        </Link>
      </Text>
    </>
  );
}

export function EmailLayout({
  preview,
  heading,
  appUrl,
  children,
}: {
  preview: string;
  heading: string;
  appUrl: string;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: brand.background,
          fontFamily: sans,
          margin: 0,
          padding: '40px 16px',
        }}
      >
        <Container style={{ maxWidth: '440px', padding: 0 }}>
          {/* Same lockup as the app header: ghost mark, then the wordmark. */}
          <Link
            href={appUrl}
            style={{
              color: brand.foreground,
              display: 'inline-block',
              fontSize: '16px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              marginBottom: '16px',
              textDecoration: 'none',
            }}
          >
            <Img
              alt=""
              height="20"
              src={`${appUrl}/email/ghost-mark.png`}
              style={{ display: 'inline-block', verticalAlign: '-4px' }}
              width="20"
            />
            <span style={{ paddingLeft: '8px' }}>Ghost</span>
          </Link>

          {/* Same card as the auth forms: white, hairline border, rounded-xl. */}
          <Section
            style={{
              backgroundColor: brand.card,
              border: `1px solid ${brand.border}`,
              borderRadius: '14px',
              padding: '24px',
            }}
          >
            <Text
              style={{
                color: brand.foreground,
                fontSize: '20px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                lineHeight: '28px',
                margin: '0 0 16px',
              }}
            >
              {heading}
            </Text>
            {children}
          </Section>

          <Text
            style={{
              ...text.muted,
              fontSize: '12px',
              margin: '16px 0 0',
              textAlign: 'center',
            }}
          >
            <Link href={appUrl} style={{ color: brand.muted }}>
              Ghost
            </Link>
            {' · host your git repositories, issues and pull requests.'}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
