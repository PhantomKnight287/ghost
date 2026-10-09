"use client";

import { DeviceAuthorization } from "@/components/auth/device-authorization/device-authorization";

/** better-auth-ui's device flow: it reads `user_code` from the URL, verifies it, and lets the signed-in user approve or deny. */
export function DeviceForm() {
  return <DeviceAuthorization />;
}
