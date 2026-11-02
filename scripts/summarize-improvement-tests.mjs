import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const rawReport='.local/acs-all-improvements-tests.json',bytes=await fs.readFile(rawReport),data=JSON.parse(bytes),files=data.testResults;
if(!data.success||data.numFailedTests||data.numPassedTests!==data.numTotalTests)throw new Error('Selected suite did not pass; preserve the raw report');
const report={status:'VERIFIED_SELECTED_TESTS_NOT_FULL_BASELINE',at:new Date().toISOString(),rawReport,sha256:createHash('sha256').update(bytes).digest('hex'),tests:data.numTotalTests,passed:data.numPassedTests,failed:data.numFailedTests,files:files.length,allSelectedPassed:true,scope:'Selected reliability/production/storage/governance and quality/UX improvements suites. Legacy eSpeak prerequisites remain separate.',results:files.map(file=>({file:path.relative(process.cwd(),file.name),status:file.status,tests:file.assertionResults.length}))};
await fs.writeFile('docs/evidence/acs-improvements-tests.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));
