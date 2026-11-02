import{describe,it,expect}from"vitest";
import{publicAddress,publicSourceUrl,fetchPublicSource}from"../src/public-source.js";
describe("Public research retrieval",()=>{
 it("rejects private, reserved and credential-bearing source URLs",()=>{
  for(const address of["127.0.0.1","192.168.0.1","192.0.0.1","192.0.2.5","192.88.99.1","169.254.169.254","10.0.0.1","::1","::ffff:127.0.0.1","fc00::1","2001:db8::1"])expect(publicAddress(address)).toBe(false);
  for(const url of["http://example.com","https://localhost","https://user:pass@example.com","https://192.168.1.1","https://example.com:8443/"])expect(()=>publicSourceUrl(url)).toThrow();
  expect(publicAddress("8.8.8.8")).toBe(true);expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  expect(publicAddress("192.0.66.161")).toBe(true);
 });
 it("checks redirect destinations before the next request and bounds document size",async()=>{
  let calls=0;await expect(fetchPublicSource("https://source.test",{transport:async()=>{calls++;return{status:302,headers:{location:"https://127.0.0.1/private"},body:""};}})).rejects.toThrow();expect(calls).toBe(1);
  await expect(fetchPublicSource("https://source.test",{maxBytes:5,transport:async()=>({status:200,headers:{"content-type":"text/plain"},body:"too large"})})).rejects.toThrow("size limit");
 });
 it("records actual content hashes, source time and readable text without running scripts",async()=>{
  const source=await fetchPublicSource("https://source.test",{transport:async()=>({status:200,headers:{"content-type":"text/html"},body:"<title>Source title</title><main>Actual evidence.<script>malicious()</script></main>"})});
  expect(source.text).toBe("Actual evidence.");expect(source.sha256).toHaveLength(64);expect(source.fetchedAt).toBeTruthy();
 });
});
