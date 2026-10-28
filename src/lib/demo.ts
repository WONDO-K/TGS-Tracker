import type { Customer, RequestRow, Person } from './types';
export const demoCustomers:Customer[]=[{id:'hanbit',name:'한빛테크',code:'HANBIT',is_active:true},{id:'saebom',name:'새봄물류',code:'SAEBOM',is_active:true}];
export const demoPeople:Person[]=[{id:'min',display_name:'김민준'},{id:'seo',display_name:'이서연'},{id:'ji',display_name:'박지훈'}];
const entries=[
 ['매출 조회 화면의 검색 조건 유지','hanbit','in_progress',true,false,false,'min'],
 ['거래명세서 출력 시 합계 금액 수정','hanbit','completed',true,true,false,'seo'],
 ['입고 내역 엑셀 다운로드 오류','saebom','verification',true,true,false,'ji'],
 ['사용자별 메뉴 접근 권한 변경','hanbit','received',true,false,false,'min'],
 ['출고 목록에 배송지 검색 추가','saebom','in_progress',true,false,false,'ji'],
 ['월별 재고 집계 기준 확인','saebom','completed',false,false,false,'seo'],
 ['로그인 세션 만료 안내 개선','hanbit','completed',true,true,true,'min'],
 ['전표 등록 화면 입력값 검증','hanbit','verification',true,true,false,'seo'],
 ['거래처 연락처 수정 요청','saebom','received',false,false,false,'ji'],
 ['발주 승인자 표시 오류','saebom','completed',true,true,true,'seo'],
] as const;
export const demoRequests:RequestRow[]=entries.map(([title,customer_id,status,requires_deployment,test,prod,created_by],i)=>({
 id:`demo-${i+1}`,number:1001+i,customer_id,title,status,requires_deployment,created_by,updated_by:created_by,
 description:`${title} 관련 현장 요청입니다.\n현재 동작을 확인하고 요청하신 내용으로 수정이 필요합니다.\n\n이 화면은 실제 업무 자료를 포함하지 않은 포트폴리오 시연 데이터입니다.`,
 requester_name:'고객사 전산 담당자',requested_on:`2026-10-${String(28-i%5).padStart(2,'0')}`,
 test_deployed_at:test?'2026-10-28T01:00:00Z':null,production_deployed_at:prod?'2026-10-28T07:00:00Z':null,
 action_summary:test?'요청 내용을 수정하고 테스트 서버에서 동작을 확인했습니다. 운영 반영 일정 확인이 필요합니다.':'',
 created_at:'2026-10-24T01:00:00Z',updated_at:`2026-10-28T${String(10-i).padStart(2,'0')}:00:00Z`,archived_at:null,version:1,attachment_count:0,
}));
