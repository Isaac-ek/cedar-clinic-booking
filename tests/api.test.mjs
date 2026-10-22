import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { handleApi } from "../lib/booking-api.ts";
import { levels } from "./contract.mjs";

let mf, db;
const testKey="local-contract-test-key";
before(async()=>{
  mf=new Miniflare({modules:true,script:"export default { fetch() { return new Response('test'); } };",compatibilityDate:"2026-05-01",d1Databases:{DB:"booking-tests"}});
  db=await mf.getD1Database("DB");
  for(const file of (await readdir("drizzle")).filter(n=>n.endsWith(".sql")).sort()) {
    for(const statement of (await readFile(`drizzle/${file}`,"utf8")).split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
});
after(async()=>{await mf?.dispose();});
async function call(path,options={}) {
  const headers={"Content-Type":"application/json"};
  if(options.apiKey!==null)headers["X-API-Key"]=options.apiKey??testKey;
  if(options.idempotencyKey)headers["Idempotency-Key"]=options.idempotencyKey;
  const request=new Request(`https://test.example/api${path}`,{method:options.method??"GET",headers,...(options.rawBody!==undefined?{body:options.rawBody}:options.body!==undefined?{body:JSON.stringify(options.body)}:{})});
  const response=await handleApi(request,{DB:db,API_KEY:testKey});
  return {status:response.status,body:await response.json(),...(response.headers.has("Retry-After")?{retryAfter:response.headers.get("Retry-After")}:{})};
}
for(const [name,run] of levels)test(name,()=>run(call));
test("Rate window expires and a slot can be booked after cooldown",async()=>{
  await call("/reset",{method:"POST",body:{slots:[{id:"cooldown",provider:"Dr Ade",start:"2099-12-10T09:00:00Z",end:"2099-12-10T09:30:00Z"}]}});
  for(let i=0;i<5;i++)assert.equal((await call("/bookings",{method:"POST",body:{slot_id:"missing",name:"Ada",email:"cooldown@example.com"}})).status,404);
  assert.equal((await call("/bookings",{method:"POST",body:{slot_id:"cooldown",name:"Ada",email:"cooldown@example.com"}})).status,429);
  // Age the database window without making the suite wait a minute.
  await db.prepare("UPDATE booking_attempts SET attempted_at = attempted_at - 60001").run();
  assert.equal((await call("/bookings",{method:"POST",body:{slot_id:"cooldown",name:"Ada",email:"cooldown@example.com"}})).status,201);
});
test("Partial unique index rejects a direct second confirmed row",async()=>{
  const first=await db.prepare("SELECT * FROM bookings WHERE status='confirmed' LIMIT 1").first();
  await assert.rejects(db.prepare("INSERT INTO bookings (id,slot_id,name,email,status,created_at) VALUES ('bypass',?,'Other','other@example.com','confirmed',?)").bind(first.slot_id,first.created_at).run(),/UNIQUE constraint failed/);
});
