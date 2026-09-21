/** A commit signed by real `git commit -S` with GnuPG, kept verbatim: the header layout it produces is what the parser has to keep matching. */
export const SIGNED_COMMIT_OBJECT = `tree 2e81171448eb9f2ee3821e3d447aa6b2fe3ddba1
author Ghost Test <test@ghost.local> 1789970104 +0530
committer Ghost Test <test@ghost.local> 1789970104 +0530
gpgsig -----BEGIN PGP SIGNATURE-----
 
 iJEEABYKADkWIQTVIMKttT07nh/UJTzniHflZMqrVQUCarDGuBsUgAAAAAAEAA5t
 YW51MiwyLjUrMS4xMiwwLDMACgkQ54h35WTKq1U+jwD8Cw4h38KzqIWyIDvq+A/A
 55fywzaHJPI7l7LiOj3jj2oBAMbZHjN6x6IOBiHYWktbqioEI+DGXIpFXZdWGR9s
 N+sL
 =EOOP
 -----END PGP SIGNATURE-----

signed commit

body line
`;

/** The Ed25519 public key that signed it, `test@ghost.local`. */
export const SIGNING_PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEarDGsRYJKwYBBAHaRw8BAQdAjVRb9oENeNU9NCHMtpjM9J9f1eHpjNNVsrHl
qCDWjnC0HUdob3N0IFRlc3QgPHRlc3RAZ2hvc3QubG9jYWw+iK8EExYKAFcWIQTV
IMKttT07nh/UJTzniHflZMqrVQUCarDGsRsUgAAAAAAEAA5tYW51MiwyLjUrMS4x
MiwwLDMCGwMFCwkIBwICIgIGFQoJCAsCBBYCAwECHgcCF4AACgkQ54h35WTKq1V4
2AD9GU0AQHkBkBc4lqFQiZh6I0WC7ds5KTFGs5iSRyhHj78BALu1JBN9/paBbVN1
BOjeFhs1QOOMDOsNwr2DIjitJYYJuDgEarDGsRIKKwYBBAGXVQEFAQEHQPvlM5RP
0xT2rxEHoEZr8GGXKsW5XRBGz09YL+lJnUgJAwEIB4iUBBgWCgA8FiEE1SDCrbU9
O54f1CU854h35WTKq1UFAmqwxrEbFIAAAAAABAAObWFudTIsMi41KzEuMTIsMCwz
AhsMAAoJEOeId+VkyqtVKHgA/jqtyCm+TtohJC9dZyKABJMYXDM6Dgx3R5iFzsyl
2NUcAP9uFbvLmb6eLDxg7XKlTGVUEM24gByij419ZUP+cRZMDg==
=2Qsw
-----END PGP PUBLIC KEY BLOCK-----
`;

export const SIGNING_KEY_ID = 'e78877e564caab55';
