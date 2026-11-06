const block=await bodyPort.read('input-a');
const match=/^Alpha \*\*bo(qwe|ㅂㅈㄷ)ld\*\* tail$/.exec(block.text);
must(!!match,'real virtual keys inserted at the preserved position: '+block.text);
return {source:block.text,inserted:match[1],actualVirtualKeys:true};
