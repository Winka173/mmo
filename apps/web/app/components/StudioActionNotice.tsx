"use client";
import Link from "next/link";
import { useId, type ButtonHTMLAttributes } from "react";
import { errorGuidance } from "./studio-guidance";

export default function StudioActionNotice({message,en}:{message:string;en:boolean}){
 const help=errorGuidance(message,en);
 return <div role="alert" className="acs-alert error acs-action-notice"><strong>{help.title}</strong><p>{help.detail}</p><Link className="acs-link-button" href={help.href}>{help.action} →</Link><details><summary>{en?"Original error details":"Chi tiết lỗi gốc"}</summary><pre>{message}</pre></details></div>;
}

/** A disabled action has an adjacent reason readable by keyboard/screen-reader users. */
export function ActionButton({reason,children,disabled,...props}:ButtonHTMLAttributes<HTMLButtonElement>&{reason?:string}){
 const id=useId(),blocked=!!disabled||!!reason;
 return <span className="acs-action-with-reason"><button {...props} disabled={blocked} aria-describedby={blocked&&reason?id:props["aria-describedby"]}>{children}</button>{blocked&&reason&&<small className="acs-muted" id={id}>{reason}</small>}</span>;
}
