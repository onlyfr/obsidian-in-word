await nativeFlow.session.select(null);
const block=await nativeFlow.port.read('input-a');
must(block.mode==='rendered' && block.text==='A 😀 한글 / 기울임 / 취소 / code 끝','native Unicode render text: '+block.text);
must(block.html.includes('<strong>한글</strong>') && block.html.includes('<em>기울임</em>') && block.html.includes('<s>취소</s>') && block.html.includes('<code>code</code>'),'native Unicode/code formatting: '+block.html);
return {block,records:await nativeFlow.port.journals()};
