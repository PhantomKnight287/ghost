import * as openpgp from 'openpgp';

export interface PublicKeyDetails {
  /** Long key id of the primary key, lowercase hex. */
  keyId: string;
  fingerprint: string;
  /** Addresses the key's user ids claim, lowercased. */
  emails: string[];
  expired: boolean;
  revoked: boolean;
}

/** Reads an armored public key, or throws when the armor is not one. */
export async function readPublicKey(
  armoredKey: string,
): Promise<PublicKeyDetails> {
  const key = await openpgp.readKey({ armoredKey });
  if (key.isPrivate()) {
    throw new Error('private key');
  }

  const emails = key
    .getUserIDs()
    .map((id) => /<([^>]+)>/.exec(id)?.[1]?.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

  // `null` means "never expires"; `Infinity` comes back for a key whose
  // expiry cannot be read at all, and neither is an expired key.
  const expiresAt = await key.getExpirationTime();

  return {
    keyId: key.getKeyID().toHex().toLowerCase(),
    fingerprint: key.getFingerprint().toLowerCase(),
    emails: [...new Set(emails)],
    expired: expiresAt instanceof Date && expiresAt < new Date(),
    revoked: await key.isRevoked(),
  };
}

/** Long key ids a signature says could have made it, lowercase hex. */
export async function signingKeyIds(
  armoredSignature: string,
): Promise<string[]> {
  const signature = await openpgp.readSignature({ armoredSignature });
  return signature
    .getSigningKeyIDs()
    .map((keyId) => keyId.toHex().toLowerCase());
}

/**
 * Whether `armoredKey` made this signature over this payload.
 *
 * The payload is verified as binary: git detach-signs the commit object with
 * no canonicalisation, so anything that rewrote line endings would verify a
 * different set of bytes than the ones git hashed.
 */
export async function verifySignature({
  payload,
  armoredSignature,
  armoredKey,
}: {
  payload: string;
  armoredSignature: string;
  armoredKey: string;
}): Promise<boolean> {
  try {
    const result = await openpgp.verify({
      message: await openpgp.createMessage({
        binary: new Uint8Array(Buffer.from(payload, 'utf8')),
      }),
      signature: await openpgp.readSignature({ armoredSignature }),
      verificationKeys: await openpgp.readKey({ armoredKey }),
      // An expired key that was valid when it signed is still proof of who
      // signed, which is what a commit badge claims.
      expectSigned: false,
      config: { allowInsecureVerificationWithReformattedKeys: false },
    });

    await result.signatures[0]?.verified;
    return result.signatures.length > 0;
  } catch {
    return false;
  }
}
