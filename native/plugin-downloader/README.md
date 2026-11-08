# Word 플러그인 다운로드 도우미 (Windows x64)

이 문서는 이전 독립 도우미의 기록이다. 새 배포는 편집기·다운로드를 통합한 [Windows 앱](../windows-host/README.md)을 사용한다. 이 코드는 기존 연결/시험 호환용으로 유지한다.

Word 작업창은 GitHub 릴리스 첨부파일을 브라우저 CORS 제한으로 직접 읽을 수 없다. 이 작은 네이티브 앱은 해당 파일만 내려받는다. 플러그인 설치·실행·설정은 기존 작업창 호스트가 담당한다. Word 본문/파일/클립보드를 읽거나 플러그인 코드를 실행하지 않는다. 복사 버튼을 직접 누를 때 연결 주소만 클립보드에 쓴다.

## 사용

1. 작업창 → 설정 → 커뮤니티 플러그인 → 다운로드 도우미 연결에서 ZIP을 받는다.
2. 압축을 풀고 `WordPluginDownloader.exe`를 실행한다. 배포 ZIP은 자체 포함 앱이므로 npm·.NET 런타임 설치가 필요 없다.
3. 도우미 창에서 **연결 주소 복사**를 누르고 작업창 연결 입력에 붙여넣어 **연결**한다. 연결 주소는 공유하지 않는다. 도우미를 다시 실행하면 주소가 바뀐다.
4. 공식 목록을 불러와 검색한 뒤 **다운로드**한다. 새 설치는 꺼짐 상태다. 설치한 플러그인의 **켜기**로 작업창 에디터에 적용한다.
5. 도우미 창을 닫으면 다운로드 연결이 종료된다. 이미 설치한 플러그인의 실행에는 도우미가 필요 없다. 연결 해제 버튼은 작업창의 연결 정보만 버린다.

다운로드는 공식 Obsidian 목록과 GitHub 정식 릴리스에서 가져온다. 모든 Obsidian API가 구현된 것은 아니며, 미지원 모듈/API와 로드 실패는 설치 목록에 표시된다. 보관함·Node/Electron·Word 본문용 플러그인 실행은 제공하지 않는다. 설치는 앱 출처의 IndexedDB에 저장되며 플러그인 설정은 기존 저장소를 사용한다.

## 개발/배포

빌드에는 .NET 10 SDK가 필요하다.

```powershell
dotnet build native/plugin-downloader/WordPluginDownloader.csproj -c Release
dotnet publish native/plugin-downloader/WordPluginDownloader.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish/helper
```

Pages 워크플로의 Windows job이 ZIP을 만들어 `dist/downloads/word-plugin-downloader.zip`으로 함께 배포한다. 로컬 개발 서버에서는 위 명령으로 빌드한 EXE를 직접 실행한다. 현재 배포는 Windows x64이며 전체 네이티브 앱/설치 프로그램 전환을 완료한 것은 아니다.

## 통신 경계

- 매 실행 무작위 loopback 포트·256비트 토큰. 정상 실행은 연결 정보를 디스크에 저장하지 않는다. 작업창도 토큰을 지속 저장하거나 localhost를 탐색하지 않는다.
- 허용 Origin은 현재 Pages 출처와 로컬 개발 출처다. Origin·Bearer 토큰이 일치하는 POST만 처리하며 허용 Origin의 preflight만 응답한다. 브라우저가 로컬 네트워크 접근 허용을 요청하면 연결에 필요하다.
- `/status`는 프로토콜 확인, `/asset`은 공식 목록의 ID/저장소와 GitHub asset ID만 받는다. 임의 URL·로컬 경로·실행 명령 API는 없다.
- HTTPS GitHub API에서 내려받고, 첨부파일 리디렉션은 `release-assets.githubusercontent.com`/`objects.githubusercontent.com`만 허용한다. 인증 쿠키·GitHub 토큰을 전달하지 않는다.
- 요청 본문 2KB, 파일 최대 20MB, 최대 동시 다운로드 2개, 다운로드 25초. 공식 목록 캐시는 5분. WebView/클라이언트도 파일별 크기·manifest ID를 검사한다.
- 개발 전용 `--allow-origin https://localhost:<port>`와 `--connection-file <path>`는 소유한 시험 서버/자동 시험에서만 사용한다. 후자는 토큰을 담은 시험 파일을 만들므로 해당 폴더를 공개하지 않는다. 이 headless 시험 모드는 기본 10분 뒤 종료하며 `--exit-after <초>`로 5–600초 사이에서 줄일 수 있다.
