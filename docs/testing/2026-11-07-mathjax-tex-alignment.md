# MathJax 직접 TeX 입력과 정렬 회귀 수정

2026-11-07. PR #37은 MathJax 기본 글리프/SVG 출력만 사용했고, TeX 입력은 Temml→MathML 중간 변환을 거쳤다. 사용자가 발견한 `align`/`aligned`의 `&` 정렬 문제는 이 경로의 실제 회귀다.

## 원인과 수정

Temml은 `aligned`의 셀 정렬을 `tml-right`/`tml-left`라는 CSS 클래스로 내보내며 표준 MathML `columnalign`을 내보내지 않는다. MathJax MathML 입력은 그 CSS 의미를 알지 못해 열을 잘못 배치했다. 글꼴만 MathJax로 맞추는 중간 변환을 사용한 것이 원인이다.

이미지 경로를 **원본 TeX → MathJax TeX 입력 → MathJax SVG → PNG**로 변경했다. SVG 도형/텍스트 허용 목록, 11pt·3배 해상도·투명 배경, 기존 LaTeX 원본 보존은 유지한다. 이미지 버전은 4로 올려 잘못 정렬된 기존 캐시를 다음 불러오기·적용 때 다시 만든다.

MathJax 3.2.2 확장 `base`, `ams`, `newcommand`, `boldsymbol`, `braket`, `cancel`, `color`, `enclose`, `bbox`, `mathtools`를 정적으로 번들한다. `ams`가 정렬 환경을 직접 처리한다. `require`/autoload/HTML 확장은 켜지 않으며 외부 확장을 내려받지 않는다. 수식별로 입력 상태를 분리해 사용자 매크로·라벨이 다음 이미지에 새지 않도록 했다. 문법 오류/사용 불가 명령은 성공 그림으로 숨기지 않고 기존 소스 보존·경고로 처리한다.

이번 수정은 **수식 이미지 경로**다. 플러그인 작업창 미리보기는 기존 Temml이며 Word 수식 우선의 지원 가능한 OMML은 기존 변환기를 사용한다. 따라서 모든 프로그램 경로가 MathJax인 것은 아니다.

## 검증

- 단위 테스트 **528건**, 타입체크·빌드 통과.
- `align`·`aligned`: 길이가 다른 두 행의 등호 글리프 위치를 비교해 x좌표가 일치하고 서로 다른 행인지 확인. 실제 Word WebView에서도 두 환경 모두 x=4610.8, y=-650/650으로 확인.
- `alignedat`: 두 정렬쌍의 등호 x좌표가 각 행에서 일치.
- 박스·취소선, 내장 글리프, SVG 안전 필터, 매크로 격리·잘못된 입력 거부 회귀 통과.
- 실제 Word `16.0.20527.20150`: `npm run test:word -- --math-only` 통과. 인라인/블록 **18종** 래스터, hybrid/images 전환, 원본 LaTeX 왕복·반복 이미지 유지. 정렬 수식 2개를 실제 삽입하고 `&`·줄바꿈 보존 및 재적용 후 중복 없음을 확인. PNG 육안 확인.
- 증거: `test-docs/word-host/20261107-201927-93dac2/math-summary.json`, `math-alignment.png`.
- 후속 사용자 사례: 실제 Word 화면에서 `S`의 이미지 ID `6f98f7f9`, `P(A)\geq 0`의 ID `a02df1c9`를 읽었고 둘 다 렌더 버전 3의 해시와 일치했다. 이는 문서에 이전 그림이 남아 있다는 증거이며 현재 작업창 코드 버전까지 단정하지는 않는다. 같은 시점 GitHub Pages는 PR #38 배포 성공 및 최신 자산 `index-DEt9hrgw.js`를 확인했다. 사용자 Word는 확인 중 닫혀 문서 새로 적용은 수행하지 않았다.
- 사용자가 제공한 포함배제 공식 전체(7행, 중간의 추가 `&` 포함)를 자동 Word 회귀에 추가했다. `test-docs/word-host/20261107-202639-2bdabc/math-summary.json`에서 7개 등호가 모두 x=7243.5, y=-3900…3900으로 일치하며, 이미지 삽입·LaTeX 왕복·재적용까지 통과. 원본 그림 660×136 CSS px, PNG 육안 확인. 기존 문서의 그림은 작업창 최신 코드 로드 후 불러오기·적용해야 갱신된다.
- 시험 첫 실행은 Vite의 새 지연 의존성 탐색이 WebView를 다시 로드해 시험 전역 변수가 사라졌다. 서버가 렌더러의 MathJax 의존성을 사전 번들하도록 수정한 뒤 전체 실행 통과. 제품의 정렬 오류와는 별개인 시험 환경 문제다.
- 메인 JS 361.41 kB / gzip 117.92 kB 유지. 이미지 지연 청크는 약 1,672 kB / gzip 583 kB이며 Vite 크기 안내가 발생한다.

MathJax AMS/입력 설정 근거:
https://docs.mathjax.org/en/v3.2/input/tex/extensions/ams.html
https://docs.mathjax.org/en/v3.2/options/input/tex.html
