"""Exercise the installed Windows product from a blank Word document (real ribbon, no test server)."""
import socket
import subprocess
import time
from pathlib import Path

import win32com.client


def listening(port):
    with socket.socket() as client:
        client.settimeout(0.5)
        return client.connect_ex(("127.0.0.1", port)) == 0


def wait_for(check, seconds, message):
    deadline = time.monotonic() + seconds
    while not check():
        if time.monotonic() > deadline:
            raise RuntimeError(message)
        time.sleep(0.2)


def running(name):
    return name.lower().encode() in subprocess.check_output(
        ["tasklist", "/fi", "imagename eq " + name, "/nh"]).lower()


if running("WINWORD.EXE") or running("ObsidianInWord.exe"):
    raise SystemExit("Close Word and the Windows app before this installed-product test.")
word = win32com.client.DispatchEx("Word.Application")
try:
    word.Visible = True
    doc = word.Documents.Add()
    wait_for(lambda: listening(49176), 15, "Word launcher did not load")
    assert not listening(49175), "Word started the editor before opening the add-in"
    ribbon = ["powershell.exe", "-NoProfile", "-File", str(Path(__file__).with_name("open-installed.ps1")), str(doc.ActiveWindow.Hwnd)]
    subprocess.run(ribbon, check=True, timeout=50)
    wait_for(lambda: listening(49175) and running("ObsidianInWord.exe"), 20, "Editor did not start")
    subprocess.run([*ribbon, "-CheckEditor"], check=True, timeout=35)
    word.Documents.Add()
    doc.Close(0)
    time.sleep(3)
    assert listening(49175), "Closing one document stopped the editor"
finally:
    word.Quit(0)
wait_for(lambda: not running("ObsidianInWord.exe") and not listening(49176), 15, "Word shutdown left the app running")
print("PASS: blank document, cold activation, second document, final Word exit")
