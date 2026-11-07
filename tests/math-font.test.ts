import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{delete (document as any).fonts;vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});
it('loads the bundled font once and embeds the same bytes in the raster SVG',async()=>{
 const load=vi.fn(async()=>{}),add=vi.fn();
 const ctor=vi.fn(function(this:any,name:string,source:string){this.load=load;});
 vi.stubGlobal('FontFace',ctor);Object.defineProperty(document,'fonts',{value:{add},configurable:true});
 const {prepareMathFont,mathFontCss}=await import('../src/convert/math-font');
 await Promise.all([prepareMathFont(),prepareMathFont()]);
 expect(ctor).toHaveBeenCalledOnce();expect(load).toHaveBeenCalledOnce();expect(add).toHaveBeenCalledOnce();
 const [name,source]=ctor.mock.calls[0];
 expect(name).toBe('Owb Latin Modern Math');expect(source).toContain('data:');
 expect(mathFontCss).toContain(source);expect(mathFontCss).toContain("font-family:'Owb Latin Modern Math' !important");
});
it('rejects font loading failure instead of silently drawing a different font',async()=>{
 vi.stubGlobal('FontFace',class{async load(){throw new Error('font unavailable');}});
 const {prepareMathFont}=await import('../src/convert/math-font');
 await expect(prepareMathFont()).rejects.toThrow('font unavailable');
});
