param([Parameter(Mandatory=$true)][int]$AppProcessId)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AcsSmokeWindow {
 public delegate bool EnumWindowProc(IntPtr window, IntPtr param);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowProc callback, IntPtr param);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
 public static bool Close(int owner) {
  IntPtr selected=IntPtr.Zero;
  EnumWindows((window,param)=>{uint process;GetWindowThreadProcessId(window,out process);if(process==(uint)owner){var title=new StringBuilder(512);GetWindowText(window,title,512);if(title.ToString().StartsWith("AUTONOMOUS CREATIVE STUDIO")){selected=window;return false;}}return true;},IntPtr.Zero);
  return selected!=IntPtr.Zero&&PostMessage(selected,0x0010,IntPtr.Zero,IntPtr.Zero);
 }
}
'@
if(-not [AcsSmokeWindow]::Close($AppProcessId)){throw 'Owned native test window not found'}
Write-Output 'WM_CLOSE sent to the owned ACS smoke window'
