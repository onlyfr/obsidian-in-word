import {beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {initSettingsDialog} from '../src/taskpane/settings-dialog';
const markup=new DOMParser().parseFromString(readFileSync('src/taskpane/index.html','utf8'),'text/html').body.innerHTML;
beforeEach(()=>{
 document.body.innerHTML=markup;
 const dialog=document.getElementById('settings-dialog') as HTMLDialogElement;
 dialog.showModal=vi.fn(()=>{dialog.open=true;});
 dialog.close=vi.fn(()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'));});
});
it('opens options, switches tabs with keyboard, and returns focus on Escape',()=>{
 initSettingsDialog();const opener=document.getElementById('open-settings')!;opener.click();
 const options=document.getElementById('options-tab')!,plugins=document.getElementById('plugins-tab')!;
 expect(document.activeElement).toBe(options);expect(opener.getAttribute('aria-expanded')).toBe('true');
 options.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 expect(plugins.getAttribute('aria-selected')).toBe('true');expect(plugins.tabIndex).toBe(0);expect(options.tabIndex).toBe(-1);
 expect(document.getElementById('options-panel')!.hidden).toBe(true);expect(document.getElementById('plugins')!.hidden).toBe(false);
 plugins.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));expect(document.activeElement).toBe(options);
 options.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));expect(document.activeElement).toBe(plugins);
 plugins.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));expect(document.activeElement).toBe(options);
 document.getElementById('settings-dialog')!.dispatchEvent(new Event('cancel',{cancelable:true}));
 expect((document.getElementById('settings-dialog') as HTMLDialogElement).open).toBe(false);
 expect(document.activeElement).toBe(opener);expect(opener.getAttribute('aria-expanded')).toBe('false');
});
it('allows plugin commands to open the plugin tab and closes through the button',()=>{
 const controller=initSettingsDialog();controller.open('plugins');
 expect(document.getElementById('plugins-tab')!.getAttribute('aria-selected')).toBe('true');
 document.getElementById('close-settings')!.click();
 expect((document.getElementById('settings-dialog') as HTMLDialogElement).open).toBe(false);
});
