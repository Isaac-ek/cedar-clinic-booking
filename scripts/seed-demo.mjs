// Intentionally manual. Never schedule this or run it after assessment submission.
const base=process.env.API_BASE_URL?.replace(/\/$/,"");
const key=process.env.API_KEY;
if(!base||!key||process.env.ALLOW_RESET!=="1")throw new Error("Set API_BASE_URL, API_KEY, and ALLOW_RESET=1. This replaces all slots and bookings.");
const today=new Date();today.setUTCHours(0,0,0,0);
const providers=["Dr Ade Bello","Dr Tola Okafor","Dr Nneka Obi"];
const slots=[];
// Include later dates so the frozen deployment remains useful during review.
for(const offset of [1,2,3,7,14,30,60]){
  const day=new Date(today.getTime()+offset*86400000).toISOString().slice(0,10);
  for(let i=0;i<6;i++){
    const hour=[8,9,10,12,13,14][i];
    slots.push({id:`cedar-${day}-${i+1}`,provider:providers[i%3],start:`${day}T${String(hour).padStart(2,"0")}:00:00Z`,end:`${day}T${String(hour).padStart(2,"0")}:30:00Z`});
  }
}
const response=await fetch(`${base}/reset`,{method:"POST",headers:{"Content-Type":"application/json","X-API-Key":key},body:JSON.stringify({slots})});
if(!response.ok)throw new Error(`Seed failed: ${response.status} ${await response.text()}`);
console.log(`Seeded ${slots.length} demo appointment slots across 7 dates.`);
