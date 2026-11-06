globalThis.noStyleMd=originalMd.replace(/^<!-- word:style[^\n]*-->\n/gm,'');
await selectAll();await word.replaceSelectionWithMarkdown(noStyleMd,async()=>true);return brief(await snapshot());
