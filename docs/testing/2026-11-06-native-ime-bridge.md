# 네이티브 IME 신호 연결·최적화 (2026-11-06)

## 결과

Windows x64 Word 16.0.20527.20112에서 실제 TSF 조합 시작·종료를 관찰해 본문 편집 게이트에 연결했다. 실제 키로 한글을 입력하고 Space로 확정한 뒤 COM으로 다른 문단을 선택하면, **수동 idle 신호 없이** 소스가 렌더링되고 외부 커서 상대 위치 4가 보존됐다. 아직 제품 UI에는 연결하지 않은 네이티브 호스트 실험이다.

## 신호 경로

`Word UI 스레드의 TSF → 네이티브 관찰기 → JSONL/SSE 개발 전송 → NativeImeConnection → BodySelectionDriver → BodyEditSession`.

TSF의 `ITfTextEditSink::OnEndEdit`에서 `EnumCompositions`를 읽는다. 문서 포커스·컨텍스트가 없거나 조회에 실패하면 unknown이다. 편집 이벤트는 상태가 바뀔 때 보고하고, 1초마다 관찰기 건강 상태를 보낸다. 건강 상태 확인은 Word 본문 텍스트/HTML 조회가 아니다. 기존 외부 IMM32에서는 컨텍스트를 얻지 못했고, 외부 UI Automation에서는 TextEdit 패턴을 얻지 못했다. Word UI 스레드의 TSF 조회는 실제 조합을 제공했다.

연결은 실행별 epoch와 순번을 검사한다. 중복 신호는 생존 시간을 늘리지 않으며, 누락·잘못된 형식·다른 실행의 신호·연결 단절은 게이트를 닫는다. 건강 신호가 2.5초간 없으면 unknown이다. 순번이 끊긴 연결은 새 연결이 필요하다.

네이티브 관찰기는 지정한 Word HWND/PID와 UI 스레드에만 연결한다. 부트스트랩 훅은 모든 메시지를 다음 훅에 전달하며 키를 막거나 문서 내용을 읽고 쓰지 않는다. 종료 시 TSF 구독과 훅을 해제한다. 늦은 콜백의 코드가 사라지지 않도록 DLL은 해당 Word 프로세스가 끝날 때까지 유지한다. 시험은 자체 Word를 종료하며 별도 애드인/레지스트리 등록을 남기지 않는다.

API 근거: [OnEndEdit](https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itftexteditsink-onendedit), [EnumCompositions](https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfcontextcomposition-enumcompositions). 구현·빌드 방법은 `native/word-ime/README.md`에 있다.

## 최적화

- 같은 idle 건강 신호가 반복돼도 선택을 다시 조회하거나 게이트를 다시 열지 않는다.
- 선택 이벤트를 병합하고, 느린 선택 조회가 진행 중일 때 추가 조회가 겹치지 않게 한다. 이전 결과는 적용하지 않고 최신 선택을 다시 읽는다.
- 문단 이탈 시 이미 읽은 소스 스냅샷을 재사용해 중복 HTML/OOXML 조회를 줄인다. 실제 변경 직전 포트의 리비전 검사는 유지한다.
- 비동기 원본 조회 중 커서가 돌아오거나 조합이 시작되면 이전 이탈 요청을 취소한다.

시간 단축 수치는 측정하지 않았다. 위 효과는 중복 호출/겹치는 조회와 취소 동작으로 검증했다. 제품 메인 번들은 기존과 같은 `index-DpU8aIih.js`, 358.31 kB / gzip 116.81 kB다.

## 검증

- 단위 테스트: 24개 파일, **442개 통과**. 연결 순번·중복·단절·건강 상태 만료·호스트 오류, 선택 조회 병합, 비동기 읽기 도중 조합/선택 변경 회귀 사례 포함.
- 타입체크·제품 빌드 통과. 네이티브 코드는 MSVC `/W4 /WX`로 빌드했다.
- 실제 입력 시험: `test-docs/word-host/20261106-205734-9018a3/input-summary.json`. TSF 편집 알림에서 active 2회와 이후 idle을 받았다. `automaticImeBridge=true`, active/unknown 중 선택 조회 **0회**, 단절 후 게이트 닫힘. 선택 범위·한글/이모지 위치 시험도 통과했다.
- 전체 Word 회귀 시험: `test-docs/word-host/20261106-205902-08faa3/report.md`. 기존 보존·반복 적용·실패 경로·수식 모드·본문 세션·저장/재열기·실행 취소/다시 실행·삭제 가드 통과.
- 시험 Word와 관찰기 종료 확인. 다른 창으로 포커스가 이동한 일부 시도는 키 입력 가드가 중단했으며 성공 시험과 구분한다.

입력 시험 명령: `npm run test:word -- --body-input-only --native-ime`. 일반 전체 시험은 관찰기를 붙이거나 실제 키를 전송하지 않는다.

## 남은 범위

현재 비동기 전송은 이미 Word에 제출된 Office.js 변경을 취소하는 원자적 잠금이 아니다. 새 조합과 변환 시작 사이의 경합까지 막으려면 **네이티브 UI 스레드에서 변경 직전 확인하는 쓰기 가드**가 필요하다. 다음 작업은 이 가드와 호스트 종료/재연결 검증이다. 다른 IME·Word 버전·복합 객체·공동 편집 검증도 남았다. 제품 UI는 이 범위를 검증한 뒤 연결한다.

이번 네이티브 관찰기와 npm/Office.js/SSE 시험 환경은 개발 기반이다. 최종 앱은 npm·개발 서버·GitHub Pages 없이 설치·실행하는 목표를 유지한다. 수식 글꼴 선택과 설정 탭은 후순위로 유지한다.
