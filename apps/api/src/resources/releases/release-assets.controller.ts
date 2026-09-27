import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import {
  ReleaseAssetDTO,
  UploadReleaseAssetQueryDTO,
} from './dto/release.dto.js';
import { ReleaseAssetsService } from './release-assets.service.js';

@Controller('repositories/:username/:repo/releases')
@ApiTags('Releases')
export class ReleaseAssetsController {
  constructor(private readonly assets: ReleaseAssetsService) {}

  @Post(':id/assets')
  @ApiOperation({
    summary: 'Upload a release asset',
    description:
      "Needs write access. Takes the raw file bytes as `application/octet-stream` with a `Content-Length`; the file's own type goes in `type`. The file counts against the storage quota of the repository's owner, when the instance sets one.",
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: ReleaseAssetDTO })
  @ApiBadRequestResponse({
    description: 'The file name is not a plain file name.',
    type: ErrorResponseDTO,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({
    description: 'The release already has an asset with this name.',
    type: ErrorResponseDTO,
  })
  @ApiPayloadTooLargeResponse({
    description:
      'The file is over the per-file limit, or would take the owner over their storage quota.',
    type: ErrorResponseDTO,
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The body was not sent as `application/octet-stream`.',
    type: ErrorResponseDTO,
  })
  uploadReleaseAsset(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('id') releaseId: string,
    @Query() query: UploadReleaseAssetQueryDTO,
    // read off the request rather than `@Headers()`, which would publish them as parameters a browser is not allowed to set
    @Req() request: Request,
    @Session() session: UserSession,
  ): Promise<ReleaseAssetDTO> {
    return this.assets.upload({
      username,
      repo,
      requesterId: session.user.id,
      releaseId,
      name: query.name,
      type: query.type,
      bodyType: request.headers['content-type'],
      contentLength: request.headers['content-length'],
      body: request,
    });
  }

  @Get('tags/:tag/assets/:name')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Download a release asset',
    description:
      'Always served as an attachment. A tag or name containing `/` is sent percent-encoded.',
  })
  @ApiOkResponse({
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async downloadReleaseAsset(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('tag') tagName: string,
    @Param('name') name: string,
    @Session() session: UserSession | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const asset = await this.assets.download({
      username,
      repo,
      requesterId: session?.user?.id,
      tagName,
      name,
    });

    response.set({
      'Content-Type': asset.contentType,
      'Content-Length': String(asset.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      // the bytes are user-controlled: never sniffed, never scripted
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-cache',
    });

    return new StreamableFile(asset.stream);
  }

  @Delete('assets/:assetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a release asset',
    description: 'Needs write access.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  deleteReleaseAsset(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('assetId') assetId: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.assets.delete({
      username,
      repo,
      requesterId: session.user.id,
      assetId,
    });
  }
}
