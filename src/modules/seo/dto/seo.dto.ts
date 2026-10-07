export class UpdateIssueStatusDto {
  status: 'OPEN' | 'RESOLVED' | 'SNOOZED';
  snoozeDays?: number; // 7, 14, 30
  snoozeReason?: string;
  resolvedBy?: string;
}

export class CreateSeoTaskDto {
  title: string;
  description?: string;
  assignee?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'RESOLVED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  related_sku?: string;
  due_date?: string;
  order_index?: number;
  monday_sign_off?: boolean;
}

export class UpdateSeoTaskDto {
  title?: string;
  description?: string;
  assignee?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'RESOLVED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  related_sku?: string;
  due_date?: string;
  order_index?: number;
  monday_sign_off?: boolean;
}

export class ToggleSignoffDto {
  weekIdentifier: string;
  itemText: string;
  isCompleted: boolean;
  signedOffBy?: string;
}
