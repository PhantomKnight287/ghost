import { DocumentBuilder } from '@nestjs/swagger';

export const openApiConfig = new DocumentBuilder()
  .setTitle('Ghost')
  .setDescription("API reference for Ghost's API")
  .setVersion('0.0.1')
  .build();
