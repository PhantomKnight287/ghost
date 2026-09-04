import { HttpStatus } from "@nestjs/common";
import { DomainError } from "../../domain/errors.js";

export class RepositoryNotFoundError extends DomainError{
  status: number = HttpStatus.NOT_FOUND

  constructor() {
    super(`Repository not found`)
  }
}

export class InvalidCursorError extends DomainError{
  status: number = HttpStatus.BAD_REQUEST

  constructor() {
    super(`Invalid pagination cursor`)
  }
}
