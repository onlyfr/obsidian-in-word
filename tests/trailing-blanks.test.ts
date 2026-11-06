import {expect,it} from 'vitest';
import {trailingBlankParagraphs} from '../src/convert/trailing-blanks';
const blank={text:'',tableNestingLevel:0,hasInlinePictures:false};
it('does not count a picture-only paragraph as blank',()=>{
 expect(trailingBlankParagraphs([{...blank,hasInlinePictures:true}])).toBe(0);
});
it('counts real spacing paragraphs after a picture-only paragraph',()=>{
 expect(trailingBlankParagraphs([{...blank,hasInlinePictures:true},blank,blank])).toBe(2);
});
it('stops at text or table cells and accepts an empty selection',()=>{
 expect(trailingBlankParagraphs([{...blank,tableNestingLevel:1},blank])).toBe(1);
 expect(trailingBlankParagraphs([{...blank,text:'content'},blank])).toBe(1);
 expect(trailingBlankParagraphs([])).toBe(0);
});
