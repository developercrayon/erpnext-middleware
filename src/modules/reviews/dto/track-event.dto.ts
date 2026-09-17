import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class TrackEventDto {
  @IsNotEmpty()
  @IsString()
  event: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  metadata?: any;
}
