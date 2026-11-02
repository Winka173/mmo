"use client";
import {useEffect,useRef,useState,type SetStateAction} from "react";
/** Small work-in-progress text is saved on each edit; applying creates immutable server versions. */
export function useRecoverableDraft<T>(key:string,identity:string,initial:T){
 const [draft,setDraft]=useState({key,identity,value:initial}),[status,setStatus]=useState<"loading"|"saved"|"saving"|"error"|"recovered">("loading"),[conflict,setConflict]=useState(false),current=useRef({key,identity,initial});current.current={key,identity,initial};
 useEffect(()=>{setConflict(false);try{
  const stored=JSON.parse(localStorage.getItem(key)??"null"),valid=stored?.identity===identity&&stored.value!==undefined&&(!Array.isArray(current.current.initial)||Array.isArray(stored.value));
  setDraft({key,identity,value:valid?stored.value:current.current.initial});setConflict(!!stored&&!valid);setStatus(valid?"recovered":"saved");
 }catch{setDraft({key,identity,value:current.current.initial});setStatus("error");}
 const changed=(event:StorageEvent)=>{if(event.key===key&&event.newValue)setConflict(true);};window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);
 },[key,identity]);
 const value=draft.key===key&&draft.identity===identity?draft.value:initial;
 const setValue=(next:SetStateAction<T>)=>setDraft(previous=>{
  const base=previous.key===key&&previous.identity===identity?previous.value:current.current.initial,result=typeof next==="function"?(next as (old:T)=>T)(base):next;
  try{localStorage.setItem(key,JSON.stringify({identity,value:result,savedAt:new Date().toISOString()}));setStatus("saved");}catch{setStatus("error");}
  return{key,identity,value:result};
 });
 const discard=()=>{try{localStorage.removeItem(key);setStatus("saved");}catch{setStatus("error");}setDraft({key,identity,value:current.current.initial});setConflict(false);};
 return{value,setValue,status,conflict,discard};
}
