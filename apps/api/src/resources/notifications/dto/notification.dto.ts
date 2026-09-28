import { schema } from '@ghost/db';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const reasons = schema.notificationReason.enumValues;
const watchLevels = [
  'participating',
  ...schema.repositoryWatchLevel.enumValues,
] as const;
export type WatchLevel = (typeof watchLevels)[number];

export class NotificationRepositoryDTO {
  @ApiProperty({ example: 'alice' })
  @IsString()
  owner: string;

  @ApiProperty({ example: 'ghost' })
  @IsString()
  slug: string;
}

export class NotificationThreadDTO {
  @ApiProperty()
  @IsInt()
  number: number;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsBoolean()
  isPullRequest: boolean;

  @ApiProperty({ enum: ['open', 'closed', 'merged'] })
  @IsIn(['open', 'closed', 'merged'])
  state: 'open' | 'closed' | 'merged';
}

export class NotificationDTO {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({
    enum: reasons,
    description: 'Why the viewer is notified, the most specific that applies.',
  })
  @IsIn(reasons)
  reason: (typeof reasons)[number];

  @ApiProperty({
    description: 'The latest event on the thread.',
    example: 'issue.commented',
  })
  @IsString()
  eventType: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Who caused the latest event.',
  })
  @IsString()
  @IsOptional()
  actorUsername: string | null;

  @ApiProperty()
  @IsBoolean()
  unread: boolean;

  @ApiProperty()
  @IsISO8601()
  updatedAt: string;

  @ApiProperty({ type: NotificationRepositoryDTO })
  @ValidateNested()
  @Type(() => NotificationRepositoryDTO)
  repository: NotificationRepositoryDTO;

  @ApiProperty({ type: NotificationThreadDTO })
  @ValidateNested()
  @Type(() => NotificationThreadDTO)
  thread: NotificationThreadDTO;
}

export class GetNotificationsQueryDTO {
  @ApiPropertyOptional({
    default: false,
    description: 'Only unread notifications.',
  })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @IsOptional()
  unread?: boolean;

  @ApiPropertyOptional({
    description:
      'Opaque cursor returned as `nextCursor` by the previous page. Omit for the first page.',
  })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size.',
    minimum: 1,
    maximum: 100,
    default: 25,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;
}

export class GetNotificationsResponseDTO {
  @ApiProperty({
    type: [NotificationDTO],
    description: 'Most recently active first.',
  })
  @ValidateNested({ each: true })
  @Type(() => NotificationDTO)
  notifications: NotificationDTO[];

  @ApiProperty({ type: String, nullable: true })
  @IsString()
  @IsOptional()
  nextCursor: string | null;
}

export class UnreadCountResponseDTO {
  @ApiProperty()
  @IsInt()
  count: number;
}

export class UpdateNotificationRequestDTO {
  @ApiProperty()
  @IsBoolean()
  unread: boolean;
}

export class IssueSubscriptionDTO {
  @ApiProperty({
    description: 'Whether activity on the thread notifies the viewer.',
  })
  @IsBoolean()
  subscribed: boolean;
}

export class RepositoryWatchDTO {
  @ApiProperty({
    enum: watchLevels,
    description:
      '`participating` notifies about threads the viewer takes part in, `all` about every thread, `ignore` about nothing, mentions included.',
  })
  @IsIn(watchLevels)
  level: WatchLevel;
}
