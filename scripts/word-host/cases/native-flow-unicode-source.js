await nativeFlow.session.select('input-a');
const snapshot=await nativeFlow.host.read('input-a');
must(snapshot.text==='A 😀 **한글** / _기울임_ / ~~취소~~ / `code` 끝','Unicode Markdown stays stable: '+snapshot.text);
must(snapshot.selectionStart-snapshot.start===8 && snapshot.selectionEnd===snapshot.selectionStart,'UTF-16 caret after emoji and Korean');
return {text:snapshot.text,caret:snapshot.selectionStart-snapshot.start};
