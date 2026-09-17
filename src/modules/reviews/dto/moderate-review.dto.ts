import { IsNotEmpty, IsEnum, IsOptional, IsString } from 'class-validator';
import { ReviewStatus } from '../../../common/enums/review.enums';

export class ModerateReviewDto {
  @IsNotEmpty()
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  @IsOptional()
  @IsString()
  moderationNotes?: string;
}
