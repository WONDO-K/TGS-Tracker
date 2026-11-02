import { demo } from "../../lib/supabase";
import { CommitPreview } from "./CommitPreview";
import { LiveCommitCompare } from "./LiveCommitCompare";
export function CommitCompare() {
  return demo ? <CommitPreview /> : <LiveCommitCompare />;
}
