import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class AddEmailDTO {
  @ApiProperty({ description: 'Address to add to the signed-in account' })
  @IsEmail()
  email: string;
}

export class UserEmailDTO {
  @ApiProperty({
    description: 'Row id, or `primary` for the account address itself',
  })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ description: 'Only verified addresses are usable' })
  verified: boolean;

  @ApiProperty({
    description: 'The address Better Auth signs the user in with',
  })
  primary: boolean;
}

export class ListEmailsResponseDTO {
  @ApiProperty({ type: [UserEmailDTO] })
  emails: UserEmailDTO[];
}
