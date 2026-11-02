export type MatchResult = "matched" | "unmatched" | "review";
export type GitHubConnection = {
  configured: boolean;
  connected: boolean;
  login?: string;
  expiresAt?: string | null;
  connectedAt?: string;
  reason?: "not_configured" | "disconnected" | "expired";
};
export type GitHubRepository = {
  id: string;
  customerId: string;
  githubId: number;
  fullName: string;
  defaultBranch: string;
};
export type AccessibleRepository = {
  githubId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};
export type GitHubBranch = { name: string; sha: string };
export type CommitSummary = {
  sha: string;
  title: string;
  message: string;
  author: string;
  date: string;
  url: string;
};
export type GitHubFile = {
  name: string;
  added: number;
  removed: number;
  status: string;
  patch?: string;
};
export type CommitDetail = CommitSummary & {
  files: GitHubFile[];
  filesComplete: boolean;
};
export type ComparedCommit = CommitSummary & {
  result: MatchResult;
  target?: string;
  evidence: string;
  candidates: CommitSummary[];
};
export type ManualLink = {
  sourceSha: string;
  targetSha: string;
  baseBranch: string;
  targetBranch: string;
  confirmedBy: string;
  confirmedAt: string;
};
export type Comparison = {
  repositoryId: string;
  baseBranch: string;
  targetBranch: string;
  baseSha: string;
  targetSha: string;
  since: string;
  comparedAt: string;
  sourceComplete: boolean;
  targetComplete: boolean;
  sourceScanned: number;
  targetScanned: number;
  rows: ComparedCommit[];
};
export type GitHubFailure = { error: { code: string; message: string } };
