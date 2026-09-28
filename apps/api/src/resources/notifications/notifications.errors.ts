import { HttpStatus } from '@nestjs/common';
import { DomainError } from '../../domain/errors.js';

export class NotificationNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Notification not found');
  }
}
