import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { NewUser } from '@ghost/db';

import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() body: NewUser) {
    return this.usersService.create(body);
  }
}
