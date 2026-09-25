export function statusOf(error: unknown) {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
}

export function isNotFound(error: unknown) {
  return statusOf(error) === 404 || (error as Error)?.name === 'NoSuchKey';
}
