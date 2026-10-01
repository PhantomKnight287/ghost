/** A failure another attempt cannot fix, such as a repository GitHub no longer lets the token read. The API fails the import instead of retrying it. */
export class PermanentImportError extends Error {}

/** The API answered 409: this attempt was superseded or the import is gone, so the job stops without reporting. */
export class StaleAttemptError extends Error {
  constructor() {
    super("The API no longer considers this attempt current");
  }
}
