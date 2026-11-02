import { NextRequest, NextResponse } from "next/server";
import * as fs from "node:fs/promises";
import path from "node:path";
/** Installed desktop requires a per-launch capability cookie on every route, including actions. */
export async function proxy(request: NextRequest) {
  const host=request.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return new NextResponse("Invalid host",{status:403});
  const originBase=`http://${host}`;
  const token=process.env.ACS_SESSION_TOKEN;
  if (!token) return NextResponse.next(); // Explicit CLI development mode, bound to loopback.
  if (request.nextUrl.pathname === "/api/desktop/pair") {
    if (request.nextUrl.searchParams.get("token") !== token) return new NextResponse("Unauthorized",{status:401});
    // Keep the literal loopback host. NextResponse.redirect wraps URLs with
    // NextURL; the accompanying skipProxyUrlNormalize config also prevents
    // Next's adapter from rewriting this Location back to localhost.
    const response=new NextResponse(null,{status:303,headers:{location:`${originBase}/`}});
    response.cookies.set("acs_session",token,{httpOnly:true,sameSite:"strict",path:"/"});
    response.headers.set("referrer-policy","no-referrer");return response;
  }
  if (request.cookies.get("acs_session")?.value !== token && request.headers.get("x-acs-token") !== token)
    return new NextResponse("Unauthorized",{status:401});
  const origin=request.headers.get("origin");
  if (!["GET","HEAD","OPTIONS"].includes(request.method) && origin !== originBase)
    return new NextResponse("Invalid origin",{status:403});
  if(process.env.ACS_DESKTOP_CONFIG&&await fs.stat(path.join(process.env.ACS_DESKTOP_CONFIG,"maintenance-request.json")).catch(()=>null)){
    const pathname=request.nextUrl.pathname;
    if(pathname.startsWith("/api/")&&!(request.method==="GET"&&["/api/studio/backups","/api/desktop/health"].includes(pathname)))
      return NextResponse.json({error:"Studio maintenance in progress / Đang bảo trì; chờ khôi phục hoàn tất"},{status:503,headers:{"retry-after":"2"}});
  }
  const response=NextResponse.next();response.headers.set("referrer-policy","no-referrer");return response;
}
export const config={matcher:["/:path*"]};
