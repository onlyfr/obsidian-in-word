# Obsidian 스타일 수식 이미지

2026-11-07. 사용자 요청에 따라 PR #36의 Latin Modern Math 이미지를 MathJax 3 기본 TeX 글리프로 교체했다. Obsidian은 공식 도움말에서 수식 렌더러로 MathJax를 안내한다. 여기서는 기본 MathJax TeX 스타일을 기준으로 하며, 사용자별 Obsidian 테마·CSS·수식 플러그인의 변경 사항까지 동일하다고 보장하지 않는다.

## 범위

- 옵션 → 수식 출력 → **모두 그림 (Obsidian 스타일 수식 글꼴)** 선택. 이미지 출력과 원본 LaTeX 왕복 정책 유지.
- 기존 Temml 파서·지원 명령·안전한 MathML 변환을 유지하고, 이미지의 글리프와 조판을 MathJax SVG 출력으로 변경했다. 작업창 미리보기 렌더러는 이번 변경 범위 밖이다.
- MathJax 3.2.2를 고정해 기본 TeX 글리프를 번들에 포함. SVG의 모든 글리프는 독립된 path이며 로컬 글꼴·CDN·외부 SVG 참조를 요구하지 않는다. 사용하지 않는 Latin Modern OTF와 로더 제거.
- 생성 SVG를 도형/텍스트 허용 목록으로 재구성해 스크립트·링크·외부 리소스·CSS를 제거한다. 11pt, 검정, 투명 PNG, 3배 해상도와 기존 여백 정책은 유지한다.
- 이미지 렌더 버전 3: 예전 Cambria/Latin Modern 그림은 다음 불러오기·적용 때 재생성한다. 문서를 자동으로 수정하지 않는다. Word 수식 우선의 OMML과 원본 보존 개체는 기존 정책대로 유지한다.

## 결과

- 단위 테스트 **524건**, 타입체크·프로덕션 빌드 통과. MathJax path 생성, SVG 필터, 테두리/취소선 유지, 이미지 크기·기준선 검증 포함.
- 실제 Word `16.0.20527.20150`, `npm run test:word -- --math-only` 통과.
- 증거: `test-docs/word-host/20261107-200424-66184d/math-summary.json` 및 `latex-font.png`.
- 인라인/블록 12종 래스터, TeX 글리프 path 확인, 적분·합·근호·분수 PNG 육안 확인. hybrid(OMML 2 + 이미지 1) → images(OMML 0 + 이미지 3) → hybrid, LaTeX 왕복과 반복 적용 이미지 유지.
- 메인 JS 361.41 kB / gzip 117.92 kB 유지. 이미지 전용 지연 청크 약 1,483 kB / gzip 536 kB이며 Vite 크기 안내가 발생한다. npm 의존성은 빌드에 사용하며 배포된 이미지 출력은 네트워크 글꼴을 요구하지 않는다.
- Apache 2.0 라이선스·출처는 제품의 `third-party/mathjax-LICENSE.txt`, `mathjax-NOTICE.txt`에도 포함한다.

출처: https://help.obsidian.md/Editing+and+formatting/Advanced+formatting+syntax
및 https://docs.mathjax.org/en/v3.2/options/output/svg.html
