await reset('<p>First <strong>bold</strong> end.</p><p>Second <em>italic</em> end.</p><p>Outside plain.</p><p>Foreign carrier.</p><p>Copy carrier.</p><p><span style="color:red">Colored carrier.</span></p><ul><li>List carrier.</li></ul>');
globalThis.selectionOriginal=await snapshot();
return {paragraphs:selectionOriginal.paragraphs};
