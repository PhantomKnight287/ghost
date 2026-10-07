import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../domain/errors.js';

export class WebhookNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Webhook not found');
  }
}

export class DeliveryNotFoundError extends DomainError {
  status: number = HttpStatus.NOT_FOUND;

  constructor() {
    super('Delivery not found');
  }
}

export class InvalidWebhookUrlError extends DomainError {
  status: number = HttpStatus.BAD_REQUEST;
}

export class WebhooksNotConfiguredError extends DomainError {
  status: number = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super(
      'Webhooks are not set up on this instance. An administrator needs to set WEBHOOK_SECRET_KEY.',
    );
  }
}
