globalThis.nativeTyped=await bodyPort.read('input-a');
must(nativeTyped.mode==='source','typing remains in source');
must(nativeTyped.text.includes('가나다'),'actual Korean input committed');
return {source:nativeTyped.text};
