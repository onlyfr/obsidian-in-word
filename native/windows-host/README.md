# Obsidian in Word — Windows 앱

Windows x64용 자체 포함 앱이다. 편집기 HTML/JS/CSS·수식 렌더러·글리프를 EXE에 포함하고 로컬 HTTPS로 Word 작업창에 제공한다. npm·Node·별도 .NET 런타임·GitHub Pages 없이 실행한다. Office.js의 Microsoft 제공 스크립트와 커뮤니티 조회/다운로드에는 인터넷 연결이 필요하다.

## 사용

1. ZIP을 풀고 `ObsidianInWord.exe`를 실행한다.
2. 처음 한 번 **Word 연결 설정**을 누른다. 현재 사용자에게 localhost TLS 인증서와 이 앱의 Word 애드인 등록을 만든다. Windows 인증서 신뢰 확인이 나타나면 내용을 확인한다. 관리자 권한이나 Office 보안 정책 완화는 요청하지 않는다.
3. **Word 열기**를 누르고 Word의 홈/삽입 → 추가 기능 → 내 추가 기능에서 **Obsidian in Word (Windows)** 를 연다. 등록 전 Word가 열려 있었다면 다시 열어야 표시될 수 있다. Word 버전/조직 정책에 따라 개발용 추가 기능 사용이 제한될 수 있다.
4. 기존 선택 영역 → 마크다운 / Word에 적용과 설정을 사용한다. 커뮤니티 다운로드는 앱에 자동 연결되며 별도 EXE·주소 복사가 필요 없다.
5. 창을 닫으면 알림 영역에서 실행된다. 앱 종료 시 작업창·다운로드 연결이 끊긴다. 다시 앱을 실행하면 같은 작업창 주소와 설정 저장소를 사용한다.

연결 해제 버튼은 이 앱이 등록한 애드인과 인증서만 해제한다. 문서 내용·사이드카·플러그인 데이터를 삭제하지 않는다. 앱 파일은 Word 연결을 해제한 뒤 제거할 수 있다. 현재는 휴대용 ZIP 배포이며 서명된 설치 프로그램·자동 업데이트·로그인 자동 실행은 후속이다.

설정 중 신뢰를 취소하거나 저장에 실패하면 이전 등록과 설정 파일을 보존하고 이번에 만든 인증서를 정리한다. 정리가 실패하면 `certificate-pending` 기록을 남기며 다음 설정/해제에서 확인한다. 새 등록이 완료된 뒤 이전 인증서를 정리하며, 앱 소유로 확인되지 않는 인증서는 삭제하지 않는다. 시작·설정·해제는 겹쳐 실행하지 않고 앱 종료는 진행 중 작업 결과를 확인한 뒤 서버를 한 번 정리한다. 이 규칙은 앱 연결 설정용이며 Word 본문을 자동 복구하는 기능이 아니다.

## 저장/연결 경계

- 고정 주소 `https://localhost:49175`, IPv4/IPv6 loopback에만 바인딩한다. 포트가 점유되면 다른 포트로 이동하지 않고 오류를 알린다. 같은 사용자 세션의 중복 앱 실행을 막는다.
- 상태는 `%LOCALAPPDATA%\ObsidianInWord`, 인증서 개인 키는 현재 사용자 Windows 키 저장소에 보관한다. 인증서는 localhost 전용 서버 인증용이며 CA 권한이 없다. 인증서 신뢰/Word 등록은 연결 설정 버튼을 눌렀을 때만 수행한다.
- Word 등록은 자체 ID `6f1d7c52-3b0e-4b6a-9a52-0a1c4f6f7c13`의 HKCU WEF Developer 값만 사용한다. 기존 Pages/dev 애드인의 등록이나 조직 정책을 덮어쓰지 않는다. 개인 사용의 사이드로드 경로이며 상용 배포 인증을 완료한 것은 아니다.
- 번들 작업창에만 호스트 표지를 넣는다. 동일 출처의 지정 헤더가 있는 세션 요청에만 매 실행 생성한 토큰을 제공한다. 다운로드 API는 Origin·토큰을 검사하고 기존 공식 목록/파일 크기/시간/리디렉션 제한을 공유한다. 외부 URL/문서 데이터를 통해 임의 localhost를 탐색하지 않는다.
- Pages와 로컬 앱은 출처가 달라 플러그인·에디터 옵션 저장소도 다르다. 기존 저장소를 삭제하지 않으며 자동 이관은 아직 제공하지 않는다. Word 문서의 원본 사이드카는 문서 안에 남아 있다.
- 본문 TSF/COM 실험을 제품에 연결하거나 본문 자동 전환을 켜지 않는다. 현재 앱의 제품 기능은 수동 Word 편집과 플러그인 관리다.

## 개발

```powershell
npm ci
npm run build
dotnet build native/windows-host/ObsidianInWord.csproj -c Release
dotnet publish native/windows-host/ObsidianInWord.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o test-docs/windows-app/publish
```

개발에는 Node/npm과 .NET 10 SDK가 필요하지만 배포 앱의 실행에는 필요하지 않다. 빌드 시 `dist`를 포함하며 런타임에 저장소 파일을 찾지 않는다. GitHub Actions에서 Windows 앱 ZIP과 웹 작업창을 함께 배포한다. Mac 지원은 현재 범위에 포함하지 않는다.

`python scripts/windows-host/run.py`는 기존 신뢰된 Office 개발 인증서를 쓰는 외부 시험 호스트로 실제 번들 UI와 소유한 Word 문서를 검사한다. 제품 EXE에는 시험 RPC/임의 코드 실행 엔드포인트가 없다. 현재 사용자 인증서 신뢰를 변경하지 않으며 시험 등록은 고유 ID로 만든 후 정리한다.

`dotnet run --project scripts/windows-setup-checks/WindowsHostChecks.csproj -c Release`는 실제 인증서 프로필과 설치·갱신·취소/실패·해제·동시 작업·종료를 격리된 저장소에서 검사한다. 개인 키는 시험에서 비영구 방식으로 생성하며 Windows 신뢰 저장소나 실제 제품 등록을 바꾸지 않는다. CI에서도 실행한다. 실제 Windows 신뢰 확인 창/첫 사용자 설정 UI는 별도 확인 항목이다.
