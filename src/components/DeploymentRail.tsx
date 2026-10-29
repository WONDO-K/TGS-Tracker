import type { RequestRow } from "../lib/types";
import { deploymentLabel } from "../lib/domain";
type Deployment = Pick<
  RequestRow,
  "requires_deployment" | "test_deployed_at" | "production_deployed_at"
>;
export function DeploymentRail({ request: r }: { request: Deployment }) {
  const pending =
    r.requires_deployment && r.test_deployed_at && !r.production_deployed_at;
  return (
    <div className="deployment-rail" aria-label={deploymentLabel(r)}>
      {r.requires_deployment && (
        <span className="rail-stages">
          <span>TEST</span>
          <i
            className={
              r.test_deployed_at ? "rail-point reflected" : "rail-point"
            }
            aria-label={r.test_deployed_at ? "테스트 반영" : "테스트 미반영"}
          />
          <span className="rail-line" />
          <i
            className={
              r.production_deployed_at ? "rail-point reflected" : "rail-point"
            }
            aria-label={r.production_deployed_at ? "운영 반영" : "운영 미반영"}
          />
          <span>PROD</span>
        </span>
      )}
      <span
        className={`deployment-tag ${pending ? "pending" : r.production_deployed_at ? "deployed" : ""}`}
      >
        {!r.requires_deployment
          ? "배포 불필요"
          : r.production_deployed_at
            ? `운영 반영 ${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }).format(new Date(r.production_deployed_at))}`
            : pending
              ? "운영 미반영"
              : "테스트 미반영"}
      </span>
    </div>
  );
}
