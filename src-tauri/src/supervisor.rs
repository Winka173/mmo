use std::{fs,path::PathBuf,process::{Child,Command,Stdio},time::{Duration,Instant}};
use std::os::windows::{io::AsRawHandle,process::CommandExt};
use tauri::Manager;
use windows_sys::Win32::{Foundation::{CloseHandle,HANDLE},System::JobObjects::{CreateJobObjectW,SetInformationJobObject,AssignProcessToJobObject,JOBOBJECT_EXTENDED_LIMIT_INFORMATION,JobObjectExtendedLimitInformation,JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE}};
struct Job(HANDLE);unsafe impl Send for Job{}impl Drop for Job{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
pub struct Process{pub child:Child,_job:Job}
impl Drop for Process{fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}}
fn job()->Result<Job,String>{unsafe{let handle=CreateJobObjectW(std::ptr::null(),std::ptr::null());if handle.is_null(){return Err("Cannot create Windows process job".into());}let mut info:JOBOBJECT_EXTENDED_LIMIT_INFORMATION=std::mem::zeroed();info.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;if SetInformationJobObject(handle,JobObjectExtendedLimitInformation,&info as *const _ as *const _,std::mem::size_of_val(&info)as u32)==0{CloseHandle(handle);return Err("Cannot configure process cleanup".into());}Ok(Job(handle))}}
pub struct Runtime{
 pub root:PathBuf,pub data:PathBuf,resources:PathBuf,pub port:u16,token:String,
 web:Option<Process>,worker:Option<Process>,maintenance:Option<Process>,
 web_attempts:usize,worker_attempts:usize,web_due:Option<Instant>,worker_due:Option<Instant>,
 web_pending:Option<Instant>,worker_pending:Option<Instant>,refresh:bool,pub blocked:bool,
}
impl Runtime{
 pub fn new(root:PathBuf,data:PathBuf,resources:PathBuf,port:u16,token:String)->Self{Self{root,data,resources,port,token,web:None,worker:None,maintenance:None,web_attempts:0,worker_attempts:0,web_due:None,worker_due:None,web_pending:None,worker_pending:None,refresh:false,blocked:false}}
 pub fn base(&self)->String{format!("http://127.0.0.1:{}",self.port)}
 pub fn pair(&self)->String{format!("{}/api/desktop/pair?token={}",self.base(),self.token)}
 fn launch(&self,script:&str,args:&[&str])->Result<Process,String>{
  let backend=self.resources.join("backend/apps/web");let node=self.resources.join("runtime/node.exe");
  if !node.is_file()||!backend.join(script).is_file(){return Err(format!("Packaged backend missing: {}",backend.join(script).display()));}
  let log=fs::OpenOptions::new().create(true).append(true).open(self.root.join(if script=="worker.mjs"{"logs/worker.log"}else if script=="maintenance.mjs"{"logs/maintenance.log"}else{"logs/web.log"})).map_err(|e|e.to_string())?;
  let owner=job()?;let mut command=Command::new(node);command.arg(backend.join(script)).args(args).current_dir(&backend).env("NODE_ENV","production").env("PORT",self.port.to_string()).env("HOSTNAME","127.0.0.1").env("DATA_DIR",&self.data).env("ACS_SESSION_TOKEN",&self.token).env("ACS_RESOURCE_ROOT",&self.resources).env("ACS_DESKTOP_CONFIG",&self.root).env("ACS_DESKTOP_EXE",std::env::current_exe().map_err(|e|e.to_string())?).env("ACS_ENGINE_RUNNER",self.resources.join("engines/runner.py")).stdout(Stdio::from(log.try_clone().map_err(|e|e.to_string())?)).stderr(Stdio::from(log)).creation_flags(0x08000000);
  let mut child=command.spawn().map_err(|e|e.to_string())?;
  if unsafe{AssignProcessToJobObject(owner.0,child.as_raw_handle()as HANDLE)}==0{let _=child.kill();let _=child.wait();return Err("Cannot contain backend process tree".into());}Ok(Process{child,_job:owner})
 }
 pub fn recover(&self)->Result<(),String>{let root=self.root.to_string_lossy();let data=self.data.to_string_lossy();let mut tool=self.launch("maintenance.mjs",&["recover",&root,&data])?;if !tool.child.wait().map_err(|e|e.to_string())?.success(){return Err("Restore recovery or worker ownership check failed. See logs/maintenance.log; no worker was started.".into());}Ok(())}
 pub fn launch_services(&mut self)->Result<(),String>{self.web=Some(self.launch("server.js",&[])?);self.worker=Some(self.launch("worker.mjs",&["run"])?);Ok(())}
 fn worker_ready(&self)->bool{let pid=self.worker.as_ref().map(|p|p.child.id()as u64);fs::read(self.data.join("locks/worker.lock")).ok().and_then(|b|serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v|v.get("pid").and_then(|n|n.as_u64())).map(|owner|Some(owner)==pid).unwrap_or(false)}
 fn web_ready(&self)->bool{ureq::get(&(self.base()+"/api/desktop/health")).set("X-ACS-Token",&self.token).timeout(Duration::from_millis(800)).call().is_ok()}
 pub fn wait_startup(&mut self)->Result<(),String>{for _ in 0..120{if dead(&mut self.web)?||dead(&mut self.worker)?{return Err("Web or worker exited during startup. See logs; another worker may own this data directory.".into());}if self.worker_ready()&&self.web_ready(){self.status("READY",None);return Ok(());}std::thread::sleep(Duration::from_millis(500));}Err("Backend startup timed out. See local logs.".into())}
 pub fn status(&self,status:&str,error:Option<&str>){let value=serde_json::json!({"product":"AUTONOMOUS CREATIVE STUDIO","supervisorPid":std::process::id(),"port":self.port,"dataDir":self.data,"webPid":self.web.as_ref().map(|p|p.child.id()),"workerPid":self.worker.as_ref().map(|p|p.child.id()),"status":status,"recovery":{"webAttempts":self.web_attempts,"workerAttempts":self.worker_attempts,"limitPerService":3},"error":error});let file=self.root.join("desktop-status.json");let temp=self.root.join("desktop-status.tmp");if fs::write(&temp,serde_json::to_vec_pretty(&value).unwrap()).is_ok(){let _=fs::rename(temp,file);}}
 fn block(&mut self,app:&tauri::AppHandle,error:&str){self.blocked=true;self.web_due=None;self.worker_due=None;self.status("RECOVERY_BLOCKED",Some(error));if let Some(window)=app.get_webview_window("main"){let detail=serde_json::to_string(&format!("ACS: {}\nKiểm tra logs trước khi mở lại / Inspect logs before reopening.",error)).unwrap();let _=window.eval(&format!("(()=>{{let box=document.getElementById('acs-native-recovery');if(!box){{box=document.createElement('div');box.id='acs-native-recovery';box.setAttribute('role','alert');box.style='position:fixed;inset:12px 12px auto;background:#fff0ed;color:#641b10;padding:20px;z-index:99999;white-space:pre-wrap';document.body.append(box);}}box.textContent={detail};}})()"));}}
 fn schedule(&mut self,worker:bool){let attempts=if worker{&mut self.worker_attempts}else{&mut self.web_attempts};*attempts+=1;let delay=[2,5,10][(*attempts-1).min(2)];if worker{self.worker_due=Some(Instant::now()+Duration::from_secs(delay));}else{self.web_due=Some(Instant::now()+Duration::from_secs(delay));self.refresh=true;}self.status("RECOVERING",Some(if worker{"Worker exited; bounded restart pending"}else{"Web backend exited; bounded restart pending"}));}
 pub fn tick(&mut self,app:&tauri::AppHandle)->Result<(),String>{
  if self.blocked{return Ok(());}
  if let Some(tool)=self.maintenance.as_mut(){if let Some(exit)=tool.child.try_wait().map_err(|e|e.to_string())?{
   self.maintenance.take();if !exit.success(){self.block(app,"Maintenance failed; data recovery must finish before restarting services");return Ok(());}
   self.launch_services()?;self.web_pending=Some(Instant::now());self.worker_pending=Some(Instant::now());self.refresh=true;self.status("RECOVERING",Some("Maintenance finished; restarting paused services"));
  }return Ok(());}
  let request=self.root.join("maintenance-request.json");
  if let Ok(metadata)=fs::metadata(&request){if metadata.modified().ok().and_then(|t|t.elapsed().ok()).map(|age|age>=Duration::from_millis(1500)).unwrap_or(false){
   let value:serde_json::Value=serde_json::from_slice(&fs::read(&request).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
   let action=value.get("action").and_then(|a|a.as_str()).unwrap_or("");if !["restore","rollback"].contains(&action)||value.get("id").and_then(|id|id.as_str()).and_then(|id|uuid::Uuid::parse_str(id).ok()).is_none(){self.block(app,"Invalid maintenance request");return Ok(());}
   // Separate Job Objects terminate only this app's web/worker descendant trees.
   self.web.take();self.worker.take();self.web_due=None;self.worker_due=None;self.web_pending=None;self.worker_pending=None;self.status("MAINTENANCE",None);
   let root=self.root.to_string_lossy();let data=self.data.to_string_lossy();self.maintenance=Some(self.launch("maintenance.mjs",&["run",&root,&data])?);return Ok(());
  }}
  if dead(&mut self.worker)?{self.worker.take();self.worker_pending=None;if self.worker_attempts>=3{self.block(app,"Worker restart limit reached (3). Production remains unavailable; inspect worker.log");return Ok(());}self.schedule(true);}
  if dead(&mut self.web)?{self.web.take();self.web_pending=None;if self.web_attempts>=3{self.block(app,"Web restart limit reached (3). Inspect web.log");return Ok(());}self.schedule(false);}
  if self.worker_due.map(|at|Instant::now()>=at).unwrap_or(false){self.worker_due=None;self.worker=Some(self.launch("worker.mjs",&["run"])?);self.worker_pending=Some(Instant::now());}
  if self.web_due.map(|at|Instant::now()>=at).unwrap_or(false){self.web_due=None;self.web=Some(self.launch("server.js",&[])?);self.web_pending=Some(Instant::now());}
  if let Some(started)=self.worker_pending{if self.worker_ready(){self.worker_pending=None;}else if started.elapsed()>Duration::from_secs(60){self.worker.take();self.worker_pending=None;if self.worker_attempts>=3{self.block(app,"Worker did not regain ownership; restart limit reached");return Ok(());}self.schedule(true);}}
  if let Some(started)=self.web_pending{if self.web_ready(){self.web_pending=None;}else if started.elapsed()>Duration::from_secs(60){self.web.take();self.web_pending=None;if self.web_attempts>=3{self.block(app,"Web did not become healthy; restart limit reached");return Ok(());}self.schedule(false);}}
  if self.worker.is_some()&&self.web.is_some()&&self.worker_pending.is_none()&&self.web_pending.is_none(){self.status("READY",None);if self.refresh{self.refresh=false;if let Some(window)=app.get_webview_window("main"){let _=window.eval("location.reload()");}}}
  Ok(())
 }
}
fn dead(slot:&mut Option<Process>)->Result<bool,String>{match slot{Some(process)=>Ok(process.child.try_wait().map_err(|e|e.to_string())?.is_some()),None=>Ok(false)}}
