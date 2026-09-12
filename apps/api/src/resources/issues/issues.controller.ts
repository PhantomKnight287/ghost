import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
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
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  CreateIssueRequestDTO,
  UpdateIssueRequestDTO,
} from './dto/create-issue.dto.js';
import {
  CreateIssueCommentRequestDTO,
  GetIssueCommentsResponseDTO,
  IssueCommentDTO,
  UpdateIssueCommentRequestDTO,
} from './dto/issue-comment.dto.js';
import {
  GetIssueTimelineResponseDTO,
  GetIssuesQueryDTO,
  GetIssuesResponseDTO,
  IssueDetailDTO,
  IssueDTO,
} from './dto/issue.dto.js';
import {
  SetIssueAssigneesRequestDTO,
  SetIssueLabelsRequestDTO,
} from './dto/label.dto.js';
import { IssuesService } from './issues.service.js';

@Controller('repositories/:username/:repo/issues')
@ApiTags('Issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Post()
  @ApiOperation({ summary: 'Open an issue' })
  @ApiCreatedResponse({ type: IssueDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  createIssue(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Body() body: CreateIssueRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.createIssue({
      username,
      repo,
      requesterId: session.user.id,
      body,
    });
  }

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'List issues' })
  @ApiOkResponse({ type: GetIssuesResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getIssues(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: GetIssuesQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.getIssues({
      username,
      repo,
      requesterId: session?.user?.id,
      query,
    });
  }

  @Get(':number')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get an issue' })
  @ApiOkResponse({ type: IssueDetailDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getIssue(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.issues.getIssue({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Patch(':number')
  @ApiOperation({ summary: 'Edit an issue title or description' })
  @ApiOkResponse({ type: IssueDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updateIssue(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: UpdateIssueRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.updateIssue({
      username,
      repo,
      number,
      requesterId: session.user.id,
      body,
    });
  }

  @Post(':number/close')
  @ApiOperation({ summary: 'Close an issue' })
  @ApiOkResponse({ type: IssueDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  closeIssue(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.issues.closeIssue({
      username,
      repo,
      number,
      requesterId: session.user.id,
    });
  }

  @Post(':number/reopen')
  @ApiOperation({ summary: 'Reopen a closed issue' })
  @ApiOkResponse({ type: IssueDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  reopenIssue(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.issues.reopenIssue({
      username,
      repo,
      number,
      requesterId: session.user.id,
    });
  }

  @Get(':number/comments')
  @OptionalAuth()
  @ApiOperation({ summary: 'Comments on an issue' })
  @ApiOkResponse({ type: GetIssueCommentsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getComments(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.issues.getComments({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Post(':number/comments')
  @ApiOperation({ summary: 'Comment on an issue' })
  @ApiCreatedResponse({ type: IssueCommentDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  createComment(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: CreateIssueCommentRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.createComment({
      username,
      repo,
      number,
      requesterId: session.user.id,
      body: body.body,
    });
  }

  @Patch(':number/comments/:commentId')
  @ApiOperation({ summary: 'Edit an issue comment' })
  @ApiOkResponse({ type: IssueCommentDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updateComment(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Body() body: UpdateIssueCommentRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.updateComment({
      username,
      repo,
      number,
      requesterId: session.user.id,
      commentId,
      body: body.body,
    });
  }

  @Delete(':number/comments/:commentId')
  @ApiOperation({ summary: 'Delete an issue comment' })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  deleteComment(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('commentId') commentId: string,
    @Session() session: UserSession,
  ) {
    return this.issues.deleteComment({
      username,
      repo,
      number,
      requesterId: session.user.id,
      commentId,
    });
  }

  @Get(':number/timeline')
  @OptionalAuth()
  @ApiOperation({ summary: 'Comments and events interleaved oldest-first' })
  @ApiOkResponse({ type: GetIssueTimelineResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getTimeline(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.issues.getTimeline({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Put(':number/labels')
  @ApiOperation({ summary: 'Replace the labels on an issue' })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  setIssueLabels(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: SetIssueLabelsRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.setIssueLabels({
      username,
      repo,
      number,
      requesterId: session.user.id,
      names: body.names,
    });
  }

  @Put(':number/assignees')
  @ApiOperation({ summary: 'Replace the assignees on an issue' })
  @ApiOkResponse({ schema: { type: 'object' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  setIssueAssignees(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: SetIssueAssigneesRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.issues.setIssueAssignees({
      username,
      repo,
      number,
      requesterId: session.user.id,
      usernames: body.usernames,
    });
  }
}
