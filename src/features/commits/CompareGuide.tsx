export function CompareGuide({ source, target }: { source: string; target: string }) {
  return (
    <section className="commit-guide" aria-label="브랜치 대조 안내">
      <p><strong>{source || "테스트 브랜치"}</strong>의 커밋이 <strong>{target || "운영 브랜치"}</strong>에도 반영되어 있는지 확인합니다.</p>
      <p>브랜치의 커밋 기준이며 실제 서버 배포 여부와 다를 수 있습니다.</p>
      <details>
        <summary>대조 방식 안내</summary>
        <dl>
          <div><dt>반영</dt><dd>동일 커밋, 체리픽 출처 또는 사용자가 확인한 연결로 반영을 확인했습니다.</dd></div>
          <div><dt>미반영</dt><dd>조회한 범위에서 해당 변경을 찾지 못했습니다.</dd></div>
          <div><dt>확인 필요</dt><dd>유사한 커밋이 있거나 조회 범위가 부족해 판단할 수 없습니다.</dd></div>
        </dl>
        <p>왼쪽은 확인할 변경이 있는 테스트 브랜치, 오른쪽은 반영 여부를 확인할 운영 브랜치입니다. 다른 브랜치를 선택해도 대조 방향은 왼쪽 → 오른쪽입니다. 오른쪽에만 있는 커밋은 이 목록에 포함되지 않습니다.</p>
      </details>
    </section>
  );
}
