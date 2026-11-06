globalThis.brief = s => ({paragraphs:s.paragraphs,tables:s.tables,pictures:s.pictures,equations:s.equations,mathImages:s.mathImages,markers:s.markers,isEmpty:s.isEmpty,floats:(s.xml.match(/<wp:anchor\b/g)||[]).length,sidecars:s.sidecars.length});
globalThis.must = (ok,message)=>{if(!ok)throw new Error('ASSERT: '+message);};
globalThis.fixture = async () => {
 await reset('<p>Start fixture</p><p></p><p>Quote fixture</p><table><tr><td>H1</td><td>H2</td></tr><tr><td>A1</td><td>A2</td></tr></table><p>After table</p><p>Equation anchor</p><p>After equation</p><p>Float anchor</p><p>End fixture</p>');
 await Word.run(async c=>{
   const eq=c.document.body.search('Equation anchor',{matchCase:true});eq.load('items');
   const quote=c.document.body.search('Quote fixture',{matchCase:true});quote.load('items');await c.sync();
   eq.items[0].insertOoxml(equations.equationPackage('<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'),'Replace');
   quote.items[0].paragraphs.getFirst().styleBuiltIn=Word.BuiltInStyleName.quote;
   await c.sync();
 });
 await selectAll();return brief(await snapshot());
};
return {wordParagraph:typeof Word.Paragraph,wordRange:typeof Word.Range,version:Office.context.diagnostics,fixture:await fixture()};
