type Shot={asset:string;text:string;durationSec:number;sourceStart:number};
type VideoClip={id:string;track:string;source:string;sourceIn:number;start:number;duration:number};
export type EditorScene={id:string;shotIndex:number|null;source:string;sourceIn:number;start:number;duration:number;text:string};
/** Edited versions navigate the saved video lane, never untrimmed narration timings. */
export function editorScenes(shots:Shot[],edited:boolean,timeline:{clips:VideoClip[]}|null):EditorScene[]{
 if(!edited){let start=0;return shots.map((shot,index)=>{const item={id:String(index),shotIndex:index,source:shot.asset,sourceIn:shot.sourceStart,start,duration:shot.durationSec,text:shot.text};start+=shot.durationSec;return item;});}
 if(!timeline)return[];
 return timeline.clips.filter(clip=>clip.track==="video").sort((a,b)=>a.start-b.start).map(clip=>{
  const segment=/(?:^|[\\/])segment-(\d+)\.mp4$/i.exec(clip.source),named=/^video-(\d+)$/.exec(clip.id);
  let shotIndex=segment?Number(segment[1]):named?Number(named[1]):null;
  if(shotIndex!==null&&!shots[shotIndex])shotIndex=null;
  if(shotIndex===null){const matches=shots.map((shot,i)=>shot.asset===clip.source?i:-1).filter(i=>i>=0);if(matches.length===1)shotIndex=matches[0];}
  return{id:clip.id,shotIndex,source:clip.source,sourceIn:clip.sourceIn,start:clip.start,duration:clip.duration,text:shotIndex===null?"":shots[shotIndex].text};
 });
}
