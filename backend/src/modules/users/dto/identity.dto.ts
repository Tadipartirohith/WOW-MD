import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length } from 'class-validator';
import { GovernmentIdType } from '../../../common/enums';

export class SubmitGovernmentIdDto {
  @ApiProperty({ enum: GovernmentIdType })
  @IsEnum(GovernmentIdType)
  idType: GovernmentIdType;

  @ApiProperty({
    example: '2234 5678 9012',
    description:
      'The number is validated, hashed and discarded — only the last four digits are stored.',
  })
  @IsString()
  @Length(8, 24)
  idNumber: string;
}
