import { registerEnumType } from '@nestjs/graphql';

export enum RepositoryVisibility { PRIVATE = 'PRIVATE', PUBLIC = 'PUBLIC' }
registerEnumType(RepositoryVisibility, { name: 'RepositoryVisibility' });

export enum RepositoryPermission { ADMIN = 'ADMIN', MAINTAIN = 'MAINTAIN', WRITE = 'WRITE', TRIAGE = 'TRIAGE', READ = 'READ' }
registerEnumType(RepositoryPermission, { name: 'RepositoryPermission' });
