import {expect,it,vi} from "vitest";
import {NativeBodyOwnership,validateNativeCandidate} from "../src/body/native-ownership";
import {nativeParagraph,type NativeBodySnapshot} from "../src/body/native-port";
import {wrapPackage} from "../src/convert/equations";
function candidate(xml=nativeParagraph('First **bold** end.')):NativeBodySnapshot{
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const text=Array.from(doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')).map(el=>el.textContent).join('');
  return {key:'candidate',epoch:'a',id:'',mode:'rendered',text,style:'Normal',xml,start:0,selectionStart:2,selectionEnd:2};
}
function host(){return {selectedKey:vi.fn<()=>Promise<string|null>>().mockResolvedValueOnce(null).mockResolvedValue('owned-a'),candidate:vi.fn(async()=>candidate()),claim:vi.fn(async()=>({code:0}))};}
it('explicitly enrolls once and confirms the exact selected identity',async()=>{
  const h=host();expect(await new NativeBodyOwnership(h).claimSelected('owned-a')).toBe('owned-a');expect(h.claim).toHaveBeenCalledOnce();
});
it('does not wrap an already owned selection again',async()=>{
  const h=host();h.selectedKey.mockReset().mockResolvedValue('existing');
  expect(await new NativeBodyOwnership(h).claimSelected('new')).toBe('existing');expect(h.candidate).not.toHaveBeenCalled();expect(h.claim).not.toHaveBeenCalled();
});
it('never retries a failed or ambiguous enrollment',async()=>{
  for(const code of [3,5,8,12,24]){const h=host();h.claim.mockResolvedValue({code});await expect(new NativeBodyOwnership(h).claimSelected('owned-a')).rejects.toThrow(`(${code})`);expect(h.claim).toHaveBeenCalledOnce();}
  const h=host();h.selectedKey.mockReset().mockResolvedValueOnce(null).mockResolvedValue('other');await expect(new NativeBodyOwnership(h).claimSelected('owned-a')).rejects.toThrow('소유권');expect(h.claim).toHaveBeenCalledOnce();
});
it('rejects foreign controls, invalid identities, and lossy formatting before enrollment',async()=>{
  const h=host();await expect(new NativeBodyOwnership(h).claimSelected('<bad>')).rejects.toThrow('ID');expect(h.selectedKey).not.toHaveBeenCalled();
  for(const snapshot of [{...candidate(),id:'foreign'},candidate(wrapPackage('<w:p><w:r><w:rPr><w:color w:val="FF0000" w:themeColor="accent1"/></w:rPr><w:t>red</w:t></w:r></w:p>')),candidate(wrapPackage('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>center</w:t></w:r></w:p>'))]){
    const h=host();h.candidate.mockResolvedValue(snapshot);await expect(new NativeBodyOwnership(h).claimSelected('owned-a')).rejects.toThrow();expect(h.claim).not.toHaveBeenCalled();
  }
});
it('accepts supported inline marks and rejects unsupported run formatting',()=>{
  expect(()=>validateNativeCandidate(candidate(nativeParagraph('**bold** _italic_ ~~strike~~ `code`')))).not.toThrow();
  expect(()=>validateNativeCandidate(candidate(wrapPackage('<w:p><w:r><w:rPr><w:sz w:val="60"/><w:color w:val="FF0000"/></w:rPr><w:t>large</w:t></w:r></w:p>')))).not.toThrow();
});
