#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{fs,net::TcpListener,path::PathBuf,sync::{Mutex,Arc},thread,time::Duration};
use tauri::{Manager,menu::{Menu,MenuItem},tray::TrayIconBuilder};
mod supervisor;
use supervisor::Runtime;
type SharedRuntime=Arc<Mutex<Option<Runtime>>>;
fn report_startup_error(handle:&tauri::AppHandle,error:&str){
 let root=std::env::var_os("ACS_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("AutonomousCreativeStudio"));
 let _=fs::create_dir_all(&root);let _=fs::write(root.join("startup-error.txt"),error);
 let mut status=fs::read(root.join("desktop-status.json")).ok().and_then(|b|serde_json::from_slice::<serde_json::Value>(&b).ok()).unwrap_or_else(||serde_json::json!({"product":"AUTONOMOUS CREATIVE STUDIO"}));
 status["status"]=serde_json::json!("FAILED");status["error"]=serde_json::json!(error);
 let _=fs::write(root.join("desktop-status.json"),serde_json::to_vec_pretty(&status).unwrap());
 if let Some(window)=handle.get_webview_window("main"){
  let _=window.set_title("ACS — Startup failed / Không thể khởi động");
  let detail=format!("{}\nLogs: {}\nĐóng app và mở lại sau khi xử lý lỗi / Close and reopen after resolving the error.",error,root.join("logs").display());
  let _=window.eval(&format!("document.getElementById('startup-status').textContent='Không thể khởi động / Startup failed';document.getElementById('startup-detail').textContent={};",serde_json::to_string(&detail).unwrap()));
 }
}
fn start(app:&tauri::AppHandle)->Result<(Runtime,String),String>{
 let resources=app.path().resource_dir().map_err(|e|e.to_string())?;
 let root=std::env::var_os("ACS_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("AutonomousCreativeStudio"));
 fs::create_dir_all(root.join("logs")).map_err(|e|e.to_string())?;
 let legacy=PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("TuToMoFactory/data");
 let data=std::env::var_os("ACS_DATA").map(PathBuf::from).unwrap_or_else(||if legacy.join("config/settings.json").is_file(){legacy}else{root.join("data")});
 fs::create_dir_all(&data).map_err(|e|e.to_string())?;
 let port=TcpListener::bind("127.0.0.1:0").map_err(|e|e.to_string())?.local_addr().unwrap().port();
 let token=uuid::Uuid::new_v4().simple().to_string()+&uuid::Uuid::new_v4().simple().to_string();
 let mut runtime=Runtime::new(root,data,resources,port,token);
 runtime.recover()?;runtime.launch_services()?;runtime.status("STARTING",None);runtime.wait_startup()?;let url=runtime.pair();Ok((runtime,url))
}
fn main(){
 let mut context=tauri::generate_context!();
 // Explicit config roots are independent app instances (including diagnostics).
 // WebView2 cannot share one browser profile across different debug arguments.
 // Preserve the normal user's existing default profile when no override exists.
 let isolated_window=std::env::var_os("ACS_CONFIG_DIR").and_then(|root|{
  let profile=PathBuf::from(root).join("webview");
  context.config_mut().app.windows.iter_mut().find(|window|window.label=="main").map(|window|{let config=window.clone();window.create=false;(config,profile)})
 });
 tauri::Builder::default().setup(move|app|{
  if let Some((config,profile))=&isolated_window{fs::create_dir_all(profile)?;tauri::WebviewWindowBuilder::from_config(app,config)?.data_directory(profile.clone()).build()?;}
  let show=MenuItem::with_id(app,"show","Open Studio",true,None::<&str>)?;let quit=MenuItem::with_id(app,"quit","Quit (stop background work)",true,None::<&str>)?;
  let menu=Menu::with_items(app,&[&show,&quit])?;
  TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).menu(&menu).on_menu_event(|app,event|match event.id.as_ref(){"show"=>{if let Some(w)=app.get_webview_window("main"){let _=w.show();let _=w.set_focus();}},"quit"=>app.exit(0),_=>{}}).build(app)?;
  let state:SharedRuntime=Arc::new(Mutex::new(None));app.manage(state.clone());
  let handle=app.handle().clone();thread::spawn(move||match start(&handle){Ok((runtime,url))=>{
   if let Ok(mut slot)=state.lock(){*slot=Some(runtime);}if let Some(window)=handle.get_webview_window("main"){let _=window.navigate(url.parse().unwrap());}
   loop{thread::sleep(Duration::from_millis(400));if let Ok(mut slot)=state.lock(){match slot.as_mut(){Some(runtime)=>{if let Err(error)=runtime.tick(&handle){runtime.blocked=true;runtime.status("RECOVERY_BLOCKED",Some(&error));report_startup_error(&handle,&error);}},None=>break}}else{break}}
  },Err(error)=>report_startup_error(&handle,&error)});
  Ok(())
 }).on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event {let root=std::env::var_os("ACS_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(||PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap()).join("AutonomousCreativeStudio"));let quit=fs::read(root.join("preferences.json")).ok().and_then(|b|serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v|v.get("closeAction").and_then(|a|a.as_str()).map(|s|s=="quit")).unwrap_or(false);api.prevent_close();if quit{window.app_handle().exit(0);}else{let _=window.hide();}}}).build(context).expect("ACS desktop startup failed").run(|app,event|{if let tauri::RunEvent::Exit=event {if let Some(state)=app.try_state::<SharedRuntime>(){if let Ok(mut runtime)=state.lock(){runtime.take();}}}});
}
