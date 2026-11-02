import path from "node:path";
import * as fs from "node:fs/promises";
import {seedSemanticFixture} from "./semantic-fixture.js";
const base=path.resolve(process.env.ACS_SEMANTIC_UI_ROOT??"");
if(!base.startsWith(path.join(process.cwd(),".local","semantic-ui")+path.sep))throw new Error("Choose an isolated semantic UI fixture folder");
seedSemanticFixture(base).then(async({data,sources})=>{await fs.writeFile(path.join(base,"fixture.json"),JSON.stringify({data,sources}));}).catch(error=>{console.error(error);process.exitCode=1;});
