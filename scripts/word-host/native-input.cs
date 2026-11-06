// Test helper only. Inject virtual-key down/up events into a verified foreground test Word process.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WordInputProbe {
 [StructLayout(LayoutKind.Sequential)] struct RECT { public int L,T,R,B; }
 [StructLayout(LayoutKind.Sequential)] struct GUI { public uint Size,Flags; public IntPtr Active,Focus,Capture,Menu,Move,Caret; public RECT Rect; }
 [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort Vk,Scan; public uint Flags,Time; public IntPtr Extra; }
 [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int X,Y; public uint Data,Flags,Time; public IntPtr Extra; }
 [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEY Key; [FieldOffset(0)] public MOUSE Mouse; }
 [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint Type; public UNION Data; }
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder name,int count);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint process);
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GUI info);
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] data,int size);
 [DllImport("user32.dll")] static extern int GetKeyboardLayoutList(int count,[Out] IntPtr[] layouts);
 [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
 [DllImport("imm32.dll")] static extern IntPtr ImmGetContext(IntPtr h);
 [DllImport("imm32.dll")] static extern bool ImmReleaseContext(IntPtr h,IntPtr context);
 [DllImport("imm32.dll")] static extern bool ImmGetOpenStatus(IntPtr context);
 [DllImport("imm32.dll")] static extern bool ImmSetOpenStatus(IntPtr context,bool open);
 [DllImport("imm32.dll")] static extern bool ImmGetConversionStatus(IntPtr context,out uint conversion,out uint sentence);
 [DllImport("imm32.dll")] static extern bool ImmSetConversionStatus(IntPtr context,uint conversion,uint sentence);
 [DllImport("imm32.dll",CharSet=CharSet.Unicode)] static extern int ImmGetCompositionStringW(IntPtr context,uint index,byte[] data,uint size);
 public static long[] Layouts() {
  int count=GetKeyboardLayoutList(0,null);var data=new IntPtr[count];GetKeyboardLayoutList(count,data);
  return Array.ConvertAll(data,h=>h.ToInt64());
 }
 public static long Layout(IntPtr window) {uint pid;return GetKeyboardLayout(GetWindowThreadProcessId(window,out pid)).ToInt64();}
 public static uint ProcessId(IntPtr window) {uint pid;GetWindowThreadProcessId(window,out pid);return pid;}
 public static void Focus(IntPtr window) {
  uint pid;uint target=GetWindowThreadProcessId(window,out pid);uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid);
  uint current=GetCurrentThreadId();bool attached=foreground!=current && AttachThreadInput(current,foreground,true);
  bool targetAttached=target!=current && target!=foreground && AttachThreadInput(current,target,true);
  try{ShowWindow(window,9);BringWindowToTop(window);SetForegroundWindow(window);Thread.Sleep(100);}
  finally{if(targetAttached)AttachThreadInput(current,target,false);if(attached)AttachThreadInput(current,foreground,false);}
  Thread.Sleep(100);Guard(window);
 }
 static void Guard(IntPtr window) {
  uint expected,actual;GetWindowThreadProcessId(window,out expected);GetWindowThreadProcessId(GetForegroundWindow(),out actual);
  if(expected==0 || expected!=actual || GetAncestor(window,2)!=GetAncestor(GetForegroundWindow(),2)){var name=new StringBuilder(128);GetClassName(GetForegroundWindow(),name,128);throw new InvalidOperationException("Test Word window is not foreground (expected="+expected+", actual="+actual+", class="+name+"); no keys sent.");}
 }
 public static void UseLayout(IntPtr window,long layout) {
  PostMessage(window,0x50,IntPtr.Zero,new IntPtr(layout));Thread.Sleep(200);
  if(Layout(window)!=layout)throw new InvalidOperationException("Word did not activate the requested existing keyboard layout.");
 }
 public static void Key(IntPtr window,int vk) {
  Guard(window);
  var down=new INPUT{Type=1,Data=new UNION{Key=new KEY{Vk=(ushort)vk}}};
  var up=new INPUT{Type=1,Data=new UNION{Key=new KEY{Vk=(ushort)vk,Flags=2}}};
  if(SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(INPUT)))!=2)throw new Win32Exception(Marshal.GetLastWin32Error());
 }
 static IntPtr Focused(IntPtr window) {
  uint pid;var info=new GUI{Size=(uint)Marshal.SizeOf(typeof(GUI))};
  if(!GetGUIThreadInfo(GetWindowThreadProcessId(window,out pid),ref info))return IntPtr.Zero;
  return info.Focus;
 }
 public sealed class ImeState {public long Layout,Focus;public bool HasContext,Open;public uint Conversion,Sentence;public int CompositionBytes;public string Composition;}
 public static ImeState Observe(IntPtr window) {
  var focus=Focused(window);var context=ImmGetContext(focus);var state=new ImeState{Layout=Layout(window),Focus=focus.ToInt64(),HasContext=context!=IntPtr.Zero};
  if(context==IntPtr.Zero)return state;
  try{
   state.Open=ImmGetOpenStatus(context);ImmGetConversionStatus(context,out state.Conversion,out state.Sentence);
   state.CompositionBytes=ImmGetCompositionStringW(context,8,null,0);
   if(state.CompositionBytes>0){var bytes=new byte[state.CompositionBytes];ImmGetCompositionStringW(context,8,bytes,(uint)bytes.Length);state.Composition=Encoding.Unicode.GetString(bytes);}
   return state;
  }finally{ImmReleaseContext(focus,context);}
 }
 public static bool NativeMode(IntPtr window,bool korean) {
  Guard(window);var focus=Focused(window);var context=ImmGetContext(focus);if(context==IntPtr.Zero)return false;
  try{uint conversion,sentence;ImmGetConversionStatus(context,out conversion,out sentence);return ImmSetOpenStatus(context,korean) && ImmSetConversionStatus(context,korean?conversion|1U:conversion&~1U,sentence);}
  finally{ImmReleaseContext(focus,context);}
 }
 public static void RestoreState(IntPtr window,ImeState state) {
  var focus=Focused(window);if(GetAncestor(focus,2)!=GetAncestor(window,2))return;
  var context=ImmGetContext(focus);if(context==IntPtr.Zero || !state.HasContext)return;
  try{ImmSetConversionStatus(context,state.Conversion,state.Sentence);ImmSetOpenStatus(context,state.Open);}
  finally{ImmReleaseContext(focus,context);}
 }
}
