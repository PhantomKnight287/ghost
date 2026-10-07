/** The message of anything thrown, for a log line or a stored failure reason. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
