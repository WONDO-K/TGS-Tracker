export type Status = "received" | "in_progress" | "verification" | "completed";
export interface Profile {
  id: string;
  display_name: string;
  email: string;
  role: "admin" | "member";
  is_active: boolean;
}
export interface Customer {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}
export interface Person {
  id: string;
  display_name: string;
}
export interface RequestRow {
  id: string;
  number: number;
  customer_id: string;
  title: string;
  description: string;
  requester_name: string | null;
  requested_on: string;
  status: Status;
  requires_deployment: boolean;
  test_deployed_at: string | null;
  production_deployed_at: string | null;
  action_summary: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  version: number;
  attachment_count?: number;
}
export interface Activity {
  id: string;
  request_id: string;
  kind: "action" | "note" | "system";
  body: string;
  created_by: string;
  created_at: string;
  metadata: Record<string, unknown>;
}
export interface Attachment {
  id: string;
  request_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  state: "pending" | "ready";
  created_by: string;
  created_at: string;
}
export interface Filters {
  customer?: string;
  search?: string;
  deployment?: string;
  from?: string;
  to?: string;
  author?: string;
  archived?: boolean;
  inactive?: boolean;
}
export interface RequestInput {
  customer_id: string;
  title: string;
  description: string;
  requester_name: string;
  requested_on: string;
  requires_deployment: boolean;
}
export interface ListResult {
  rows: RequestRow[];
  total: number;
  counts: Record<Status, number>;
  pending: number;
}
