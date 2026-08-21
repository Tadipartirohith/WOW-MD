import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class SendAadhaarOtpDto {
  @ApiProperty({
    example: '2345 6789 0124',
    description:
      'Twelve digits. Validated, hashed and discarded — never stored, logged or returned.',
  })
  @IsString()
  @Length(12, 19)
  aadhaarNumber: string;
}

export class VerifyAadhaarOtpDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  sessionId: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'The code is 6 digits' })
  code: string;
}
