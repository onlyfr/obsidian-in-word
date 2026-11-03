# obsidian-in-word

Microsoft Word 안에서 Obsidian 스타일 마크다운(위키링크, callout, frontmatter, 수식 등)으로 편집할 수 있게 해 주는 Word 애드인 프로젝트입니다.

> **면책 / Disclaimer**
> 이 프로젝트는 Microsoft 및 Obsidian과 **무관한 비공식 개인 프로젝트**입니다. Word를 더 편하게 사용하려고 개인적으로 만들고 있습니다.
> This is an unofficial personal project, not affiliated with or endorsed by Microsoft or Obsidian. "Word" and "Obsidian" are trademarks of their respective owners.

## 목표

- Word 객체 ↔ Obsidian 마크다운을 상호 변환 가능한 단위로 정의하고 관리
- 마크다운으로 표현할 수 없는 Word 전용 객체는 메타데이터(사이드카)로 보존
- CodeMirror 6 기반 편집 환경에서 호환되는 커뮤니티 확장(예: Latex Suite 같은 편집/문법 계열) 사용

## 상태

초기 단계(PoC)입니다.

## 개발 (PoC)

현재 구현: Word 작업창에 CodeMirror 6 에디터를 띄우고, 선택 영역을 마크다운으로 가져와 편집한 뒤 Word에 다시 적용합니다. 변환은 `markdown-it`(md→HTML)과 `turndown`(HTML→md)에 위키링크/callout 처리를 얹은 최소 구현입니다.

```bash
npm install
npm test        # 변환 단위 테스트
npm run build   # 타입체크 + 번들
```

### 로컬 서버 없이 사용 (GitHub Pages)
`main`에 푸시하면 GitHub Actions가 빌드해서 GitHub Pages(`https://onlyfr.github.io/obsidian-in-word/`)에 정적 파일로 배포합니다. 이 경우 로컬 서버나 인증서 없이 `manifest.prod.xml`만 Word에 사이드로드하면 됩니다. 코드는 서버가 아니라 Word 작업창 안에서 실행됩니다.

사전 설정: 저장소 Settings → Pages → Source를 **GitHub Actions**로 지정해야 합니다.

### 개발용 로컬 서버
코드를 수정하며 바로 확인하려면 HTTPS 개발 서버와 `manifest.xml` 사이드로드가 필요합니다.

1. `certs/localhost.key`, `certs/localhost.crt`를 준비합니다 (예: `mkcert localhost`).
2. `npm run dev` 로 `https://localhost:3000` 서버를 띄웁니다.
3. `manifest.xml`을 Word에 사이드로드합니다 ([Microsoft 문서](https://learn.microsoft.com/office/dev/add-ins/testing/test-debug-office-add-ins) 참고).

### Word 전용 객체 보존
표, 이미지, 도형, 변경 추적, 각주, 필드 등 마크다운으로 표현할 수 없는 블록은 편집기에서 `<!-- word:obj id=… kind=… -->` 한 줄로 보입니다. 원본은 문서 안의 Custom XML Part(사이드카)에 id별로 저장되고, "Word에 적용" 시 그 자리에 그대로 복원됩니다. 자리표시자를 옮기면 객체도 따라 움직이고, 지우면 객체도 삭제됩니다.

### 스타일과 위키링크
- 일반 문단은 Word의 Normal 스타일(`MsoNormal`)로 들어가고, 그 외 문단 스타일(인용, 사용자 정의 등)은 문단 앞의 `<!-- word:style class=… name=… -->` 한 줄로 보존됩니다.
- `[[위키링크]]`는 하이퍼링크가 아니라 **글자 그대로** Word에 들어갑니다. 왕복해도 `[[ ]]`가 유지됩니다.

### 수식 (Word 수식 ↔ `$…$` / `$$…$$`)
Word의 `getHtml`은 수식을 그냥 GIF `<img>`로만 내보내므로(OMML 없음), 수식 원본은 같은 범위의 OOXML(`getOoxml`)에서 읽어 HTML의 이미지와 순서로 짝지읍니다. 짝이 맞지 않으면(표 안 등) 수식을 건드리지 않고 적용을 중단합니다.

- **불러오기**: OMML → LaTeX 변환(자체 구현, 외부 라이브러리·MML2OMML.XSL 미사용). 문단 안의 수식은 `$…$`, 독립 수식(`m:oMathPara`)은 `$$ … $$` 블록. 원본 OMML은 LaTeX를 키로 사이드카(`kind=math`)에 저장됩니다.
- **적용**: 고치지 않은 수식은 저장된 원본 OMML을 **바이트 그대로** 복원하고, 새로 쓰거나 고친 LaTeX는 LaTeX → OMML로 변환해 `insertOoxml`로 넣습니다(편집 가능한 실제 Word 수식).
- **안전장치**: 변환할 수 없는 LaTeX가 있거나 선택 영역의 수식이 마크다운보다 많으면 적용을 중단합니다. `$` 문자 그대로의 텍스트는 `\$` 로 이스케이프됩니다.

### 커뮤니티 플러그인 호스트 (초기)
`src/plugins/host.ts`는 Obsidian 플러그인의 `main.js`(CommonJS)를 불러와 에디터 확장(`registerEditorExtension`)과 명령(`addCommand`)을 수집합니다. `obsidian` 모듈은 최소한만 흉내 내며(Plugin, Notice, Platform 등), 지원하지 않는 API나 모듈은 오류 대신 **호환성 보고서**에 기록됩니다. 아직 작업창 UI에는 연결되어 있지 않고, 실제 Latex Suite 같은 플러그인과의 호환은 검증하지 않았습니다. 플러그인은 내려받은 코드를 그대로 실행하므로 신뢰하는 것만 사용하세요.

### 알려진 한계
- 불투명 블록 안의 텍스트는 마크다운으로 편집할 수 없습니다 (이미지가 한 장이라도 들어 있는 문단 전체가 하나의 블록이 됩니다).
- 객체 복원은 `getHtml`/`insertHtml` 기반이라 Word 고유 서식이 일부 손실될 수 있습니다 (추후 OOXML 기반으로 개선 예정).
- 사이드카는 현재 쌓이기만 하고 정리되지 않습니다.
- 실제 Word에서의 동작은 아직 검증하지 못했습니다 (변환 로직만 테스트됨).
- Word 본문에서 직접 타이핑할 때는 CM6 확장(스니펫 등)이 동작하지 않고, 작업창 에디터 안에서만 동작합니다.
- 수식은 LaTeX로 바꿀 수 있는 범위(분수, 첨자, 합/적분, 근호, 괄호, 행렬, 악센트, 함수, 그리스 문자, `\text`)만 편집할 수 있습니다. 그 밖의 수식(박스, 위상 기호 등)이 든 문단은 문단 전체가 `<!-- word:obj … kind=equation -->` 로 보존됩니다. 표 안의 수식과, 수식을 지우는 적용은 중단됩니다.
- 커뮤니티 확장 로딩은 아직 작업창 UI에 연결되어 있지 않습니다.
