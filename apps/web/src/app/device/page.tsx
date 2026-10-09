import type { Metadata } from "next";

import { DeviceForm } from "./device-form";

export const metadata: Metadata = { title: "Device activation" };

export default function DevicePage() {
  return (
    // Centered as the auth pages center their cards; the card carries its own title.
    <div className="flex flex-1 items-center justify-center p-4 md:p-6">
      <DeviceForm />
    </div>
  );
}
