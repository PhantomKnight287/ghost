import { createSafeActionClient } from "next-safe-action";

/** Server actions report a thrown error's message to the form that called them. */
export const actionClient = createSafeActionClient({
  handleServerError: (error) => error.message,
});
