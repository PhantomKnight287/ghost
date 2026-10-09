/** GitHub's GraphQL error `type` for a DomainError's HTTP status. gh branches on NOT_FOUND and FORBIDDEN. */
export function graphqlErrorType(status: number) {
  if (status === 404) return 'NOT_FOUND';
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status >= 400 && status < 500) return 'UNPROCESSABLE';
  return 'INTERNAL';
}
