import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Deleting an account asks for the password and nothing else.
 *
 * No second factor: somebody who has lost their authenticator should still be
 * able to leave, and requiring a code they do not have would trap them here.
 * The password proves it is them, and the action is refused outright while any
 * money is in flight.
 */
export class EraseAccountDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
