import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  type WebhookEvent,
  webhookEvents,
} from '../../../lib/webhooks/webhooks.js';

const eventsProperty = {
  enumName: 'WebhookEvent',
  enum: webhookEvents,
  isArray: true,
};

export class CreateWebhookRequestDTO {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsString()
  @MaxLength(2048)
  url: string;

  @ApiProperty({
    ...eventsProperty,
    description: 'Events that trigger a delivery. At least one.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(webhookEvents, { each: true })
  events: WebhookEvent[];
}

export class UpdateWebhookRequestDTO {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional(eventsProperty)
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(webhookEvents, { each: true })
  events?: WebhookEvent[];

  @ApiPropertyOptional({
    description:
      'Turning an endpoint back on clears the reason it was turned off.',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class WebhookDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  url: string;

  @ApiProperty(eventsProperty)
  events: WebhookEvent[];

  @ApiProperty()
  active: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why Ghost turned the endpoint off, such as a 410 Gone.',
  })
  disabledReason: string | null;

  @ApiProperty()
  createdAt: string;
}

export class CreatedWebhookDTO extends WebhookDTO {
  @ApiProperty({
    description:
      'Signs every delivery. Shown only now: Ghost stores it encrypted and never returns it again.',
  })
  secret: string;
}

export class WebhookSecretDTO {
  @ApiProperty({
    description:
      'The new signing secret. The old one stops working at once, and this is the only time the new one is shown.',
  })
  secret: string;
}

export class ListWebhooksResponseDTO {
  @ApiProperty({ type: [WebhookDTO] })
  webhooks: WebhookDTO[];
}

export class DeliveryAttemptDTO {
  @ApiProperty()
  startedAt: string;

  @ApiProperty()
  durationMs: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null when no response came back.',
  })
  statusCode: number | null;

  @ApiProperty({ type: String, nullable: true })
  error: string | null;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  requestHeaders: Record<string, string>;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The first 4 KB of the response.',
  })
  responseBody: string | null;
}

export class DeliveryDTO {
  @ApiProperty({ description: 'Sent as `X-Ghost-Delivery`.' })
  id: string;

  @ApiProperty()
  event: string;

  @ApiProperty({
    enumName: 'DeliveryStatus',
    enum: schema.deliveryJobStatus.enumValues,
    description:
      '`dead` means Ghost gave up. A redelivery sends it again as a new delivery.',
  })
  status: (typeof schema.deliveryJobStatus.enumValues)[number];

  @ApiProperty({ description: 'The JSON body the receiver gets.' })
  body: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When the next try is due, while the delivery is pending.',
  })
  nextAttemptAt: string | null;

  @ApiProperty({ type: [DeliveryAttemptDTO], description: 'Newest first.' })
  attempts: DeliveryAttemptDTO[];
}

export class ListDeliveriesResponseDTO {
  @ApiProperty({ type: [DeliveryDTO], description: 'The 50 most recent.' })
  deliveries: DeliveryDTO[];
}
