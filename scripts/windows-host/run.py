"""Test the real bundled host with an owned Word document; no certificate trust changes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import winreg
import socket
import ssl
from urllib.request import Request,urlopen

repo=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('word_harness',repo/'scripts/word-host/run.py');harness=importlib.util.module_from_spec(spec);spec.loader.exec_module(harness)
if b'WINWORD.EXE' in subprocess.run(['tasklist','/FI','IMAGENAME eq WINWORD.EXE','/NH'],capture_output=True).stdout:raise SystemExit('Close Word before this owned-fixture test.')
deadline=time.monotonic()+100
while True:
 with socket.socket() as check:
  if check.connect_ex(('127.0.0.1',49175))!=0:break
 if time.monotonic()>deadline:raise RuntimeError('Previous bounded test server has not expired')
 time.sleep(.25)
run=repo/'test-docs/windows-host'/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6]);run.mkdir(parents=True)
settings=sorted((Path(os.environ['LOCALAPPDATA'])/'npm-cache/_npx').glob('*/node_modules/office-addin-dev-settings'))[-1]
harness.prepare(run,settings,49175)
manifest=run/'manifest.xml';text=manifest.read_text().replace('https://localhost:49175/scripts/word-host/client.html','https://localhost:49175/index.html');manifest.write_text(text)
import xml.etree.ElementTree as ET
ident=ET.fromstring(text).find('{http://schemas.microsoft.com/office/appforoffice/1.1}Id').text
registry=r'Software\Microsoft\Office\16.0\WEF\Developer'
with winreg.CreateKey(winreg.HKEY_CURRENT_USER,registry) as key:winreg.SetValueEx(key,ident,0,winreg.REG_SZ,str(manifest))
word=None
with (run/'server.log').open('w') as server_log,(run/'word.log').open('w') as word_log:
 try:
  server=subprocess.Popen(['dotnet','run','--project',str(repo/'scripts/windows-host/Acceptance.csproj'),'-c','Release','--',str(run),str(Path.home()/'.office-addin-dev-certs')],cwd=repo,stdout=server_log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  deadline=time.monotonic()+40
  while not (run/'server-ready').exists():
   if server.poll() is not None or time.monotonic()>deadline:raise RuntimeError('Host test server failed; inspect '+str(run/'server.log'))
   time.sleep(.1)
  word=subprocess.Popen(['powershell.exe','-NoProfile','-STA','-File',str(repo/'scripts/word-host/word-com.ps1'),'-RunDirectory',str(run)],cwd=repo,stdout=word_log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
  harness.wait_result(run,'js','ready',90,word)
  result=harness.command(run,'js','windows-app',(repo/'scripts/windows-host/word-case.js').read_text(encoding='utf-8'),worker=word)
  (run/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print('Evidence: '+str(run),flush=True)
 finally:
  if word is not None and word.poll() is None:
   harness.command(run,'com','close','$true',15);word.wait(timeout=20)
  with winreg.OpenKey(winreg.HKEY_CURRENT_USER,registry,0,winreg.KEY_ALL_ACCESS) as key:
   if winreg.QueryValueEx(key,ident)[0]==str(manifest):winreg.DeleteValue(key,ident)
  if (run/'stop-token').exists():
   try:subprocess.run(['powershell.exe','-NoProfile','-File',str(repo/'scripts/windows-host/stop.ps1'),'-RunDirectory',str(run)],check=True,capture_output=True,timeout=10)
   except Exception:pass # The owned headless server also expires on its own after three minutes.
