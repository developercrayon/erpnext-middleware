export enum ProcessingStatus {
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  EXTRACTED = 'EXTRACTED',
  MATCHING = 'MATCHING',
  VALIDATING = 'VALIDATING',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  APPROVED = 'APPROVED',
  CREATING = 'CREATING',
  CREATED = 'CREATED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum ConfidenceLevel {
  HIGH = 'HIGH',       // >= 90%
  MEDIUM = 'MEDIUM',   // 75% - 89%
  LOW = 'LOW',         // < 75%
}

export enum ValidationSeverity {
  ERROR = 'ERROR',     // Blocks invoice creation
  WARNING = 'WARNING', // Can continue with confirmation
  INFO = 'INFO',       // Informational
}
