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

초기 단계(아이디어 / PoC 준비 중)입니다.

## 개발 (PoC)

현재 구현: Word 작업창에 CodeMirror 6 에디터를 띄우고, 선택 영역을 마크다운으로 가져와 편집한 뒤 Word에 다시 적용합니다. 변환은 `markdown-it`(md→HTML)과 `turndown`(HTML→md)에 위키링크/callout 처리를 얹은 최소 구현입니다.

```bash
npm install
npm test        # 변환 단위 테스트
npm run build   # 타입체크 + 번들
```

Word에서 실행하려면 HTTPS 개발 서버와 사이드로드가 필요합니다.

1. `certs/localhost.key`, `certs/localhost.crt`를 준비합니다 (예: `mkcert localhost`).
2. `npm run dev` 로 `https://localhost:3000` 서버를 띄웁니다.
3. `manifest.xml`을 Word에 사이드로드합니다 ([Microsoft 문서](https://learn.microsoft.com/office/dev/add-ins/testing/test-debug-office-add-ins) 참고).

### 알려진 한계
- 실제 Word에서의 동작은 아직 검증하지 못했습니다 (변환 로직만 테스트됨).
- Word 본문에서 직접 타이핑할 때는 CM6 확장(스니펫 등)이 동작하지 않고, 작업창 에디터 안에서만 동작합니다.
- Word 전용 객체 보존(사이드카 메타데이터), 수식(OMML↔LaTeX), 커뮤니티 확장 로딩은 아직 없습니다.
