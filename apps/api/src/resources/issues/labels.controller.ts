import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Session,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  CreateLabelRequestDTO,
  GetLabelsResponseDTO,
  LabelDTO,
  UpdateLabelRequestDTO,
} from './dto/label.dto.js';
import { IssuesService } from './issues.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('repositories/:username/:repo/labels')
@ApiTags('Labels')
export class LabelsController {
  constructor(private readonly issues: IssuesService) {}

  @Get()
  @SignInOptional()
  @ApiOperation({ summary: 'List labels in a repository' })
  @ApiOkResponse({ type: GetLabelsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listLabels(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Session() session: UserSession,
  ) {
    return this.issues.listLabels({
      username,
      repo,
      requesterId: session?.user?.id,
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create a label' })
  @ApiCreatedResponse({ type: LabelDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  createLabel(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Body() body: CreateLabelRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.createLabel({
      username,
      repo,
      requesterId: session.user.id,
      body,
    });
  }

  @Patch(':labelId')
  @ApiOperation({ summary: 'Update a label' })
  @ApiOkResponse({ type: LabelDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  updateLabel(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('labelId') labelId: string,
    @Body() body: UpdateLabelRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.updateLabel({
      username,
      repo,
      requesterId: session.user.id,
      labelId,
      body,
    });
  }

  @Delete(':labelId')
  @ApiOperation({ summary: 'Delete a label' })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  deleteLabel(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('labelId') labelId: string,
    @Session() session: UserSession,
  ) {
    return this.issues.deleteLabel({
      username,
      repo,
      requesterId: session.user.id,
      labelId,
    });
  }
}
