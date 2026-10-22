import assert from "node:assert/strict";

const future = "2099-12-10";
const slot = (id, hour = 9, provider = "Dr Ade") => ({ id, provider, start: `${future}T${String(hour).padStart(2,"0")}:00:00Z`, end: `${future}T${String(hour).padStart(2,"0")}:30:00Z` });
const person = (slot_id, email = "ada@example.com") => ({ slot_id, name: "Ada Obi", email });
const expectStatus = (response, status) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
async function reset(call, slots = [slot("s1"), slot("s2", 10), slot("s3", 11)]) {
  expectStatus(await call("/reset", { method: "POST", body: { slots } }), 200);
}
const book = (call, body, key) => call("/bookings", { method: "POST", body, ...(key ? { idempotencyKey: key } : {}) });

export const levels = [
  ["Level 1: reset, sorted slots, exact provider, durable booking and lookup", async (call) => {
    await reset(call, [slot("s2", 10, "Dr Tola"), slot("s1"), slot("s3", 9)]);
    const slots = expectStatus(await call("/slots"), 200).slots;
    assert.deepEqual(slots.map(s => s.id), ["s1", "s3", "s2"]);
    assert(slots.every(s => s.available === true));
    assert.deepEqual(expectStatus(await call("/slots?provider=Dr%20Tola"),200).slots.map(s => s.id), ["s2"]);
    assert.deepEqual(expectStatus(await call("/slots?provider=dr%20tola"),200).slots, []);
    const booking = expectStatus(await book(call, person("s1")), 201);
    assert.equal(booking.status, "confirmed"); assert(booking.id); assert(Number.isFinite(Date.parse(booking.created_at)));
    assert.deepEqual(expectStatus(await call(`/bookings/${booking.id}`),200), booking);
    assert.equal(expectStatus(await call("/slots"),200).slots[0].available, false);
    expectStatus(await call("/bookings/missing"),404);
    await reset(call, []);
    assert.deepEqual(expectStatus(await call("/slots"),200), { slots: [] });
    expectStatus(await call(`/bookings/${booking.id}`),404);
  }],
  ["Level 2: API key, validation, normalization, past slots, atomic reset", async (call) => {
    await reset(call, [slot("s1"), { id:"past", provider:"Dr Ade", start:"2020-01-01T09:00:00Z",end:"2020-01-01T09:30:00Z" }]);
    for (const path of ["/slots", "/bookings?email=ada@example.com", "/bookings/missing"]) {
      expectStatus(await call(path, { apiKey: null }),401);
      expectStatus(await call(path, { apiKey: "incorrect" }),401);
    }
    for (const [path,method] of [["/reset","POST"],["/bookings","POST"],["/bookings/missing","DELETE"]]) expectStatus(await call(path,{method,apiKey:null,body:{}}),401);
    const invalid = [{}, {slot_id:"s1",name:"Ada"}, person("s1", "bad-email"), {slot_id:"s1",name:"  ",email:"empty@example.com"}, {slot_id:[],name:"Ada",email:"wrongtype@example.com"}, {slot_id:"s1",name:123,email:"wrongname@example.com"}, null, []];
    for (const body of invalid) expectStatus(await book(call,body),400);
    expectStatus(await call("/bookings",{method:"POST",rawBody:"{"}),400);
    expectStatus(await book(call,person("no-slot","unknown@example.com")),404);
    expectStatus(await book(call,person("past","past@example.com")),400);
    const saved = expectStatus(await book(call,{slot_id:"s1",name:"  Ada Obi  ",email:"  ADA@EXAMPLE.COM  "}),201);
    assert.equal(saved.name,"Ada Obi"); assert.equal(saved.email,"ada@example.com");
    expectStatus(await call("/reset",{method:"POST",body:{slots:[slot("duplicate"),slot("duplicate")]}}),400);
    assert.equal(expectStatus(await call("/slots"),200).slots.length,2);
    assert.deepEqual(expectStatus(await call(`/bookings/${saved.id}`),200),saved);
    expectStatus(await call("/slots",{method:"POST"}),405);
    const err=await call("/unknown");expectStatus(err,404);assert.deepEqual(Object.keys(err.body),["error"]);
  }],
  ["Level 3: 40 simultaneous contenders, cancellation, rebooking and cancel race", async (call) => {
    await reset(call);
    const contenders = await Promise.all(Array.from({length:40},(_,i)=>book(call,person("s1",`race${i}@example.com`))));
    assert.equal(contenders.filter(r=>r.status===201).length,1);
    assert.equal(contenders.filter(r=>r.status===409).length,39);
    const winner=contenders.find(r=>r.status===201).body;
    const cancellations = await Promise.all([call(`/bookings/${winner.id}`,{method:"DELETE"}),call(`/bookings/${winner.id}`,{method:"DELETE"})]);
    assert.deepEqual(cancellations.map(r=>r.status).sort(),[200,409]);
    assert.equal(expectStatus(await call(`/bookings/${winner.id}`),200).status,"cancelled");
    assert.equal(expectStatus(await call("/slots"),200).slots[0].available,true);
    expectStatus(await book(call,person("s1","rebook@example.com")),201);
    expectStatus(await call("/bookings/missing",{method:"DELETE"}),404);
  }],
  ["Level 4: concurrent idempotency, original responses, conflicts and cursor pages", async (call) => {
    await reset(call);
    const body=person("s1");
    const responses=await Promise.all(Array.from({length:16},()=>book(call,body,"same-key")));
    for(const r of responses){expectStatus(r,201);assert.deepEqual(r.body,responses[0].body);}
    expectStatus(await book(call,person("s2"),"same-key"),422);
    expectStatus(await book(call,{email:body.email,name:body.name,slot_id:body.slot_id},"same-key"),201);
    await call(`/bookings/${responses[0].body.id}`,{method:"DELETE"});
    assert.deepEqual(expectStatus(await book(call,body,"same-key"),201),responses[0].body);
    const failed=await book(call,person("missing","errors@example.com"),"failed-key");expectStatus(failed,404);
    assert.deepEqual(await book(call,person("missing","errors@example.com"),"failed-key"),failed);
    const mixed = await Promise.all([book(call,person("s2","mixed@example.com"),"mixed-key"),book(call,person("s3","mixed@example.com"),"mixed-key")]);
    assert.deepEqual(mixed.map(r=>r.status).sort(),[201,422]);
    await reset(call,Array.from({length:7},(_,i)=>slot(`p${i}`,9+i)));
    const created=[];
    for(let i=0;i<5;i++)created.push(expectStatus(await book(call,person(`p${i}`)),201));
    await book(call,person("p5","other@example.com"));
    const seen=[];let cursor=null;
    do{const page=expectStatus(await call(`/bookings?email=ADA%40EXAMPLE.COM&limit=2${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`),200);seen.push(...page.bookings);cursor=page.next_cursor;if(seen.length>10)throw new Error("pagination loop");}while(cursor);
    assert.deepEqual(seen,created);
    for(const limit of ["0","51","-1","1.5","foo",""])expectStatus(await call(`/bookings?email=ada@example.com&limit=${limit}`),400);
    expectStatus(await call("/bookings?email=ada@example.com&cursor=invalid"),400);
    expectStatus(await call("/bookings"),400);
    assert.deepEqual(expectStatus(await call("/bookings?email=nobody@example.com"),200),{bookings:[],next_cursor:null});
  }],
  ["Level 5: failed attempts, per-email isolation and simultaneous rate limiting", async (call) => {
    await reset(call,Array.from({length:20},(_,i)=>slot(`r${i}`,i+1)));
    for(let i=0;i<5;i++)expectStatus(await book(call,person("missing","  SPAM@EXAMPLE.COM  ")),404);
    const limited=await book(call,person("r0","spam@example.com"));expectStatus(limited,429);
    assert(/^\d+$/.test(limited.retryAfter));assert(Number(limited.retryAfter)>0&&Number(limited.retryAfter)<=60);
    expectStatus(await book(call,person("r0","different@example.com")),201);
    const simultaneous=await Promise.all(Array.from({length:12},(_,i)=>book(call,person(`r${i+1}`,"concurrent@example.com"))));
    assert.equal(simultaneous.filter(r=>r.status===201).length,5);
    assert.equal(simultaneous.filter(r=>r.status===429).length,7);
    await reset(call);
    expectStatus(await book(call,person("s1","spam@example.com")),201);
  }],
];
