import {expect,it} from "vitest";
import {htmlToMarkdown,markdownToHtml} from "../src/convert/obsidian";
import {MemorySidecar} from "../src/convert/sidecar";

it.each([
 ["<p><b><strong>굵게</strong></b></p>","**굵게**"],
 ["<p><i><em>기울임</em></i></p>","_기울임_"],
 ["<p><s><strike>취소</strike></s></p>","~~취소~~"],
 ["<p><b>굵게 <i><strong>함께</strong></i></b></p>","**굵게 _함께_**"],
 ["<p><span lang='en'><b>bo</b></span><strong><span lang='ko'>한글</span></strong><b>ld</b></p>","**bo한글ld**"],
 ["<p><b>one</b> <strong>two</strong></p>","**one** **two**"],
 ["<p><b><i>a</i></b><strong><em>b</em></strong></p>","**_ab_**"],
 ["<p><em><b>함께</b></em></p>","**_함께_**"],
 ["<p><s><em><strong>모두</strong></em></s></p>","**_~~모두~~_**"],
 ["<p>**literal** ~literal~ - literal</p>","\\*\\*literal\\*\\* \\~literal\\~ - literal"],
])("normalizes redundant Word inline formatting: %s",(html,expected)=>expect(htmlToMarkdown(html)).toBe(expected));

it("does not grow emphasis or list markers over five Word-shaped round trips",()=>{
 const source="**굵게** and _기울임_ and ~~취소~~\n\n- **항목**\n    - ~~중첩~~";
 let current=source;
 for(let cycle=0;cycle<5;cycle++){
  const doc=new DOMParser().parseFromString(markdownToHtml(current),"text/html");
  for(const el of doc.querySelectorAll('strong,em,s')){
   const wrapper=doc.createElement(el.tagName==='STRONG'?'b':el.tagName==='EM'?'i':'strike');el.replaceWith(wrapper);wrapper.append(el);
  }
  current=htmlToMarkdown(doc.body.innerHTML);
  expect(current).toBe(source);
 }
});
it('leaves tracked deletion originals untouched',()=>{
 const sidecar=new MemorySidecar();const html='<p><b><strong>keep</strong></b><del>deleted</del></p>';
 const md=htmlToMarkdown(html,sidecar);expect(md).toContain('kind=tracked');
 expect([...sidecar.entries()][0][1].html).toContain('<b><strong>keep</strong></b>');
});
it('collapses already-amplified bold Markdown without changing escaped literal markers',()=>{
 expect(htmlToMarkdown(markdownToHtml('****굵게****'))).toBe('**굵게**');
 expect(htmlToMarkdown(markdownToHtml('\\*\\*글자 그대로\\*\\*'))).toBe('\\*\\*글자 그대로\\*\\*');
});
