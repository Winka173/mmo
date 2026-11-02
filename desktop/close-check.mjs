import {spawn} from 'node:child_process';
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function close(root,pid){return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',root+'/desktop/window-close.ps1','-AppProcessId',String(pid)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.on('close',code=>code===0?resolve():reject(new Error(error||`WM_CLOSE helper ${code}`)));});}
export async function exerciseClosePolicy(page,root,status,pid){
 const base=`http://127.0.0.1:${status.port}`;await page.goto(base+'/studio/settings');await page.getByRole('heading',{name:'Ứng dụng Windows',exact:true}).waitFor();await page.getByLabel('Khi đóng cửa sổ',{exact:true}).selectOption('hide');await page.getByRole('button',{name:'Lưu tùy chọn app',exact:true}).click();
 for(let i=0;i<30;i++){const s=await page.evaluate(()=>fetch('/api/desktop/preferences').then(r=>r.json()));if(s.available&&s.preferences.closeAction==='hide'&&!s.preferences.autostart)break;if(i===29)throw new Error('Native preferences were not saved');await new Promise(r=>setTimeout(r,100));}
 await close(root,pid);await new Promise(r=>setTimeout(r,700));if(![pid,status.webPid,status.workerPid].every(alive))throw new Error('Hide-close stopped background processes');
 // Hidden WebView still has its authenticated session. Autostart remains false throughout.
 const response=await page.evaluate(async()=>{const r=await fetch('/api/desktop/preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({closeAction:'quit',autostart:false})});return r.status;});if(response!==200)throw new Error('Native close preference update rejected');
 await close(root,pid);for(let i=0;i<60&&[pid,status.webPid,status.workerPid].some(alive);i++)await new Promise(r=>setTimeout(r,200));if([pid,status.webPid,status.workerPid].some(alive))throw new Error('Quit-close left owned processes running');
 return {hideKeepsBackground:true,quitStopsOwnedProcessTree:true,autostartEnabled:false,autostartRegistryModified:false};
}
