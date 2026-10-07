import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  Session,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { ErrorResponseDTO } from '../../domain/http.js';
import { isInlineAttachment } from '../../lib/attachments/attachments.js';
import { AttachmentsService } from './attachments.service.js';
import {
  AttachmentDTO,
  UploadAttachmentQueryDTO,
} from './dto/attachment.dto.js';

@Controller()
@ApiTags('Attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('repositories/:username/:repo/attachments')
  @ApiOperation({
    summary: 'Attach a file',
    description:
      "Needs read access. Takes the raw file bytes as `application/octet-stream` with a `Content-Length`. Embed the file by linking `/api/attachments/{id}` in an issue, pull request, comment or release; one no text in the repository mentions is removed after a day. The file counts against the uploader's asset quota, when the instance sets one.",
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: AttachmentDTO })
  @ApiBadRequestResponse({
    description: 'The file name is not a plain file name.',
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiPayloadTooLargeResponse({
    description:
      'The file is over the per-file limit, or would take the uploader over their storage quota.',
    type: ErrorResponseDTO,
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'The body was not sent as `application/octet-stream`, or files with this extension cannot be attached.',
    type: ErrorResponseDTO,
  })
  uploadAttachment(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: UploadAttachmentQueryDTO,
    // read off the request rather than `@Headers()`, which would publish them as parameters a browser is not allowed to set
    @Req() request: Request,
    @Session() session: UserSession,
  ): Promise<AttachmentDTO> {
    return this.attachments.upload({
      username,
      repo,
      requesterId: session.user.id,
      name: query.name,
      bodyType: request.headers['content-type'],
      contentLength: request.headers['content-length'],
      body: request,
    });
  }

  @Get('attachments/:id')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Download an attachment',
    description:
      'Readable by anyone who can read the repository it was attached in. Images are served inline, anything else as a download.',
  })
  @ApiOkResponse({
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async downloadAttachment(
    @Param('id') attachmentId: string,
    @Session() session: UserSession | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const attachment = await this.attachments.download({
      attachmentId,
      requesterId: session?.user?.id,
    });

    const disposition = isInlineAttachment(attachment.contentType)
      ? 'inline'
      : 'attachment';
    response.set({
      'Content-Type': attachment.contentType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      // the bytes are user-controlled: never sniffed, never scripted
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
    });

    return new StreamableFile(attachment.stream);
  }
}
