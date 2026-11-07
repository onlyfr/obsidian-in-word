const {createRasterizer}=await import('/src/convert/mathraster.ts');
const latex=String.raw`\int_0^\infty e^{-x^2}\,dx=\frac{\sqrt{\pi}}{2}\qquad \sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}`;
const preview=await(await createRasterizer()).render(latex,true);
const faces=[...document.fonts].filter(face=>face.family.replace(/['"]/g,'')==='Owb Latin Modern Math');
must(faces.length===1 && faces[0].status==='loaded','bundled Latin Modern Math loaded: '+JSON.stringify([...document.fonts].map(face=>({family:face.family,status:face.status}))));
must(document.fonts.check('14px "Owb Latin Modern Math"'),'font available for measurement');
return {font:'Latin Modern Math',loaded:true,latex,...preview};
