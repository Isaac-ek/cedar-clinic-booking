import { levels } from "../tests/contract.mjs";
const base=process.env.API_BASE_URL?.replace(/\/$/,"");
const key=process.env.API_KEY;
if(!base||!key||process.env.ALLOW_RESET!=="1")throw new Error("Set API_BASE_URL, API_KEY, and ALLOW_RESET=1. This suite replaces all slots and bookings. Never run after submission.");
async function call(path,options={}){
  const headers={"Content-Type":"application/json"};
  if(options.apiKey!==null)headers["X-API-Key"]=options.apiKey??key;
  if(options.idempotencyKey)headers["Idempotency-Key"]=options.idempotencyKey;
  const response=await fetch(base+path,{method:options.method??"GET",headers,...(options.rawBody!==undefined?{body:options.rawBody}:options.body!==undefined?{body:JSON.stringify(options.body)}:{})});
  const body=await response.json();
  return {status:response.status,body,...(response.headers.has("Retry-After")?{retryAfter:response.headers.get("Retry-After")}:{})};
}
for(const [name,run]of levels){await run(call);console.log(`PASS ${name}`);}
console.log("All five contract levels passed.");
