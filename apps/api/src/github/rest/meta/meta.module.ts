import { Module } from '@nestjs/common';
import { MetaService } from './meta.service.js';
import { MetaController } from './meta.controller.js';

@Module({
  controllers: [MetaController],
  providers: [MetaService],
})
export class MetaModule {}
