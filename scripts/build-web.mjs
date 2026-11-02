import { spawn } from 'node:child_process';
import path from 'node:path';
const root=process.cwd();
const child=spawn(process.execPath,['--require',path.join(root,'scripts/windows-links.cjs'),path.join(root,'apps/web/node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:path.join(root,'apps/web'),stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
child.on('exit',code=>process.exit(code??1));child.on('error',error=>{console.error(error);process.exit(1);});
