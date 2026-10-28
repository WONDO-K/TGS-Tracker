import { client, demo } from "./supabase";
import { demoCustomers, demoPeople, demoRequests } from "./demo";
import { matchesFilters } from "./domain";
import type {
  Activity,
  Attachment,
  Customer,
  Filters,
  ListResult,
  Person,
  RequestRow,
  Status,
} from "./types";
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  if (demo) throw new Error("데모는 읽기 전용입니다.");
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export async function getCustomers(): Promise<Customer[]> {
  if (demo) return demoCustomers;
  const { data, error } = await client()
    .from("customers")
    .select("*")
    .order("name");
  if (error) throw error;
  return data;
}
export async function getPeople(): Promise<Person[]> {
  return demo ? demoPeople : rpc("get_people", {});
}
export async function listRequests(
  filters: Filters,
  status: Status | null = null,
  limit = 30,
  offset = 0,
): Promise<ListResult> {
  if (!demo)
    return rpc("list_requests", {
      filters,
      status_filter: status,
      limit_count: limit,
      offset_count: offset,
    });
  const all = demoRequests.filter(
    (r) =>
      (filters.inactive ||
        demoCustomers.find((c) => c.id === r.customer_id)?.is_active) &&
      matchesFilters(r, filters),
  );
  const page = all.filter((r) => !status || r.status === status);
  return {
    rows: page.slice(offset, offset + limit),
    total: page.length,
    counts: {
      received: all.filter((r) => r.status === "received").length,
      in_progress: all.filter((r) => r.status === "in_progress").length,
      verification: all.filter((r) => r.status === "verification").length,
      completed: all.filter((r) => r.status === "completed").length,
    },
    pending: all.filter(
      (r) =>
        r.requires_deployment &&
        r.test_deployed_at &&
        !r.production_deployed_at,
    ).length,
  };
}
export async function getRequest(id: string): Promise<RequestRow> {
  if (demo) {
    const r = demoRequests.find((r) => r.id === id);
    if (!r) throw new Error("요청을 찾을 수 없습니다.");
    return r;
  }
  const { data, error } = await client()
    .from("requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}
export async function getActivities(id: string): Promise<Activity[]> {
  if (demo) return [];
  const { data, error } = await client()
    .from("request_activities")
    .select("*")
    .eq("request_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
export async function getAttachments(id: string): Promise<Attachment[]> {
  if (demo) return [];
  const { data, error } = await client()
    .from("request_attachments")
    .select("*")
    .eq("request_id", id)
    .order("created_at");
  if (error) throw error;
  return data;
}
export async function uploadAttachment(
  requestId: string,
  file: File,
  onReserved?: (a: Attachment) => void,
) {
  const a = await rpc<Attachment>("reserve_attachment", {
    request_id: requestId,
    original_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
  });
  onReserved?.(a);
  await retryUpload(a, file);
  return a;
}
export async function retryUpload(a: Attachment, file: File) {
  if (file.size !== a.size_bytes || file.type !== a.mime_type)
    throw new Error(
      "예약된 첨부와 같은 크기·형식의 파일을 선택해주세요. 취소 후 새로 첨부할 수도 있습니다.",
    );
  const { error } = await client()
    .storage.from("request-images")
    .upload(a.storage_path, file, { contentType: file.type, upsert: false });
  if (error) {
    const { data } = await client()
      .storage.from("request-images")
      .download(a.storage_path);
    if (!data) throw error;
  }
  await rpc("finalize_attachment", { id: a.id });
}
export async function deleteAttachment(a: Attachment) {
  const { error } = await client()
    .storage.from("request-images")
    .remove([a.storage_path]);
  if (error) throw error;
  await rpc("remove_attachment_record", { id: a.id });
}
