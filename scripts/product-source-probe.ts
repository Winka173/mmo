import {fetchPublicSource} from '@ttm/providers';
import {extractProductRecord} from '../apps/worker/src/product-research.js';
async function main(){for(const url of ['https://www.adafruit.com/product/4201','https://www.raspberrypi.com/products/raspberry-pi-5/']){
 try{const source=await fetchPublicSource(url);console.log(JSON.stringify({url,product:extractProductRecord(source),bytes:source.html.length}));}
 catch(error){console.log(JSON.stringify({url,error:String(error)}));}
}}
main().catch(error=>{console.error(String(error));process.exitCode=1;});
