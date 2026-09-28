import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession:false, autoRefreshToken:false } });

async function recordRuntimeError(action:string,target:string,statusCode:number|null,error:string,context:any={}){
  try{
    await sb.from("mtf_runtime_errors").insert({
      component:"mtf-cron-dispatch",
      action,
      target,
      status_code:statusCode,
      error:String(error||"").slice(0,1200),
      context
    });
  }catch(_){}
}

Deno.serve(async (req: Request) => {
  const suppliedSecret=req.headers.get("x-cron-secret");
  const {data:validSecret,error:secretError}=await sb.rpc("mtf_validate_cron_secret",{p_secret:suppliedSecret});
  if(secretError||validSecret!==true){
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "scan").toLowerCase();
  let target = "mtf-daily-backfill";
  let targetBody:any = {};
  if (action === "watcher" || action === "alert-test") {
    target = "mtf-alert-watcher";
    targetBody = action === "alert-test" ? { test:true } : {};
  } else if (action === "bootstrap-cedear") {
    target = "mtf-daily-backfill";
    targetBody = { market:"cedear", bootstrap:true };
  } else if (action === "prepare-cedear") {
    target = "mtf-daily-backfill";
    targetBody = { market:"cedear", prepare:true };
  } else if (action === "regulated-live") {
    target = "mtf-daily-backfill";
    targetBody = { market:"cedear", live_scan:true };
  }
  else if (action === "regulated-baseline") {
    target = "mtf-daily-backfill";
    targetBody = { market:"cedear", regulated_baseline:true };
  } else if (action === "adr-live") {
    target = "mtf-adr-engine";
    targetBody = { mode:"live" };
  } else if (action === "adr-baseline") {
    target = "mtf-adr-engine";
    targetBody = { mode:"baseline" };
  } else if (action === "adr-selftest") {
    target = "mtf-adr-engine";
    targetBody = { mode:"selftest" };
  } else if (action === "crypto-rebuild") {
    target = "mtf-crypto-engine";
    targetBody = { mode:"rebuild", symbol:String(body.symbol||"").toUpperCase() };
  } else if (action === "crypto-structure") {
    target = "mtf-crypto-engine";
    targetBody = { mode:"structure" };
  } else if (action === "crypto-live") {
    target = "mtf-crypto-engine";
    targetBody = { mode:"live" };
  }
  else if (action === "crypto-baseline") {
    target = "mtf-crypto-engine";
    targetBody = { mode:"baseline" };
  } else if (action === "crypto-snapshot") {
    target = "mtf-crypto-engine";
    targetBody = { mode:"snapshot", symbol:String(body.symbol||"").toUpperCase() };
  } else if (action === "crypto-universe") {
    target = "mtf-crypto-engine";
    targetBody = { mode:"universe" };
  } else if (action === "initial-scan") {
    target = "mtf-daily-backfill";
    targetBody = { market:"cedear", initial_scan:true, offset:Number(body.offset||0), limit:Number(body.limit||20) };
  } else {
    const market = String(body.market || "crypto").toLowerCase();
    if (!['crypto','cedear','merval'].includes(market)) {
      return new Response(JSON.stringify({ error: "market inválido" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (market === "crypto") {
      return new Response(JSON.stringify({ error:"legacy crypto scan retired in v3.5; use crypto-structure/crypto-live" }), {
        status: 410,
        headers: { "content-type": "application/json" },
      });
    }
    targetBody = { market };
  }
  try{
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${target}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${SERVICE_ROLE}`,
        "apikey": SERVICE_ROLE,
      },
      body: JSON.stringify(targetBody),
    });
    const text = await r.text();
    if(!r.ok){
      await recordRuntimeError(action,target,r.status,`Downstream HTTP ${r.status}`,{response:text.slice(0,1000),targetBody});
    }
    return new Response(text, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") || "application/json" },
    });
  }catch(e){
    await recordRuntimeError(action,target,null,String((e as Error).message||e),{targetBody});
    throw e;
  }
});