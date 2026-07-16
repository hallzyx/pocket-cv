// M3 Migration Test: RED -> GREEN -> ROLLBACK
import { describe,it,expect,beforeAll,afterAll } from "vitest";
import mysql from "mysql2/promise";
import path from "path";
import fs from "fs";

const DB="pocketcv_test",CFG={host:"localhost",port:33065,user:"root",password:"",charset:"utf8mb4"as const};
const DIR=path.resolve(__dirname,"../../../../db/migrations");
const BT=["professional_profile","cvs","job_offers","interviews","ai_runs","interview_events"];

function fixMariaDB(sql:string){
  sql=sql.replace(/DEFAULT\s*\(\s*now\(\s*\)\s*\)/gi,"DEFAULT CURRENT_TIMESTAMP");
  const f=(c:string)=>{const re=new RegExp("`"+c+"`\\s+timestamp\\(\\d+\\),(?!\\s*NULL|\\s*NOT)","gi");sql=sql.replace(re,"`"+c+"` timestamp(3) NULL DEFAULT NULL,");};
  f("access_token_expires_at");f("refresh_token_expires_at");return sql;
}
async function applyFile(conn:mysql.Connection,file:string){
  let sql=fs.readFileSync(path.join(DIR,file),"utf8");sql=fixMariaDB(sql);
  for(const stmt of sql.split("--> statement-breakpoint")){
    const t=stmt.trim();if(!t)continue;
    try{await conn.query(t);}catch(e:any){if([1060,1050,1061].indexOf(e.errno)>=0)continue;if(e.errno===1005&&e.sqlMessage?.includes('errno: 121'))continue;throw e;}
  }
}
const hc=(c:mysql.Connection,t:string,k:string)=>c.query("SHOW COLUMNS FROM `"+t+"` LIKE ?",[k]).then((r:any)=>r[0].length>0);
const ht=(c:mysql.Connection,t:string)=>c.query("SHOW TABLES LIKE ?",[t]).then((r:any)=>r[0].length>0);
const hi=(c:mysql.Connection,t:string,i:string)=>c.query("SHOW INDEX FROM `"+t+"` WHERE Key_name = ?",[i]).then((r:any)=>r[0].length>0);
const hf=(c:mysql.Connection,fk:string)=>c.query("SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'",[DB,fk]).then((r:any)=>r[0].length>0);
const ci=(c:mysql.Connection,t:string,k:string)=>c.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?",[DB,t,k]).then((r:any)=>r[0][0]);

// --- Canonical M1/M2 snapshot for exhaustive rollback comparison ---
const nv=(v:any):any=>{
  if(v===null||v===undefined)return null;
  if(v instanceof Date)return v.toISOString();
  if(typeof v==="string"&&/^\s*[\[{]/.test(v))try{return JSON.stringify(JSON.parse(v));}catch{}
  return v;
};
const mr=(rs:any[])=>rs.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,nv(v)])));
async function snap(conn:mysql.Connection){
  const[cols]=await conn.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN(?) ORDER BY TABLE_NAME,ORDINAL_POSITION",[DB,BT]);
  const[cs]=await conn.query("SELECT tc.CONSTRAINT_NAME,tc.TABLE_NAME,tc.CONSTRAINT_TYPE,kcu.COLUMN_NAME,kcu.REFERENCED_TABLE_NAME,kcu.REFERENCED_COLUMN_NAME,kcu.ORDINAL_POSITION,rc.DELETE_RULE FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_SCHEMA=kcu.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME AND tc.TABLE_NAME=kcu.TABLE_NAME LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON tc.CONSTRAINT_SCHEMA=rc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=rc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=? AND tc.TABLE_NAME IN(?) ORDER BY tc.CONSTRAINT_NAME,tc.TABLE_NAME,kcu.ORDINAL_POSITION",[DB,BT]);
  const[ix]=await conn.query("SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN(?) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX",[DB,BT]);
  const[pr]=await conn.query("SELECT * FROM professional_profile ORDER BY id");
  const[cv]=await conn.query("SELECT * FROM cvs ORDER BY id");
  const[of]=await conn.query("SELECT * FROM job_offers ORDER BY id");
  const[iv]=await conn.query("SELECT * FROM interviews ORDER BY id");
  const[ar]=await conn.query("SELECT * FROM ai_runs ORDER BY id");
  const[ie]=await conn.query("SELECT * FROM interview_events ORDER BY id");
  return{columns:mr(cols as any[]),constraints:mr(cs as any[]),indexes:mr(ix as any[]),profiles:mr(pr as any[]),cvs:mr(cv as any[]),job_offers:mr(of as any[]),interviews:mr(iv as any[]),ai_runs:mr(ar as any[]),interview_events:mr(ie as any[])};
}

// --- Comprehensive M3 schema assertion ---
async function assertM3(conn:mysql.Connection){
  const jc:[string,string,string,string|null][]=[
    ["normalized_text","longtext","YES",null],["confidence","decimal(4,3)","YES",null],
    ["status","enum('draft','analyzed','awaiting_critical','awaiting_optional','ready','generated','failed')","NO","draft"],
    ["questions_json","longtext","YES",null],["selection_json","longtext","YES",null],["overrides_json","longtext","YES",null],
  ];
  for(const[col,ct,nu,de]of jc){const c=await ci(conn,"job_offers",col);expect(c.COLUMN_TYPE).toBe(ct);expect(c.IS_NULLABLE).toBe(nu);if(de===null)expect(c.COLUMN_DEFAULT===null||c.COLUMN_DEFAULT==="NULL").toBe(true);else expect(String(c.COLUMN_DEFAULT)).toMatch(/^'?draft'?$/);}
  const ua=await ci(conn,"job_offers","updated_at");expect(ua.COLUMN_TYPE).toBe("datetime");expect(ua.IS_NULLABLE).toBe("NO");expect(ua.COLUMN_DEFAULT).toMatch(/current_timestamp/i);expect(ua.EXTRA).toMatch(/on update.*current_timestamp/i);
  expect(await ht(conn,"job_offer_generations")).toBe(true);
  const gg:[string,string,string,string|null][]=[
    ["id","varchar(128)","NO",null],["job_offer_id","varchar(128)","NO",null],["generation_request_id","varchar(128)","NO",null],
    ["cv_id","varchar(128)","YES",null],["status","enum('running','completed','failed')","NO","running"],
    ["ats_score","int(11)","YES",null],["suggestions","longtext","YES",null],["error","text","YES",null],
    ["created_at","datetime","NO","_ts"],["updated_at","datetime","NO","_ts"],
  ];
  for(const[col,ct,nu,de]of gg){const c=await ci(conn,"job_offer_generations",col);expect(c.COLUMN_TYPE).toBe(ct);expect(c.IS_NULLABLE).toBe(nu);if(de===null)expect(c.COLUMN_DEFAULT===null||c.COLUMN_DEFAULT==="NULL").toBe(true);else if(de==="_ts")expect(c.COLUMN_DEFAULT).toMatch(/current_timestamp/i);else expect(String(c.COLUMN_DEFAULT)).toMatch(/^'?running'?$/);}
  for(const[col,ct,nu,de]of[["job_offer_id","varchar(128)","YES",null],["generation_request_id","varchar(128)","YES",null],["attempt","int(11)","NO","1"]]as[string,string,string,string|null][]){
   const c=await ci(conn,"ai_runs",col);expect(c.COLUMN_TYPE).toBe(ct);expect(c.IS_NULLABLE).toBe(nu);if(de===null)expect(c.COLUMN_DEFAULT===null||c.COLUMN_DEFAULT==="NULL").toBe(true);else expect(String(c.COLUMN_DEFAULT)).toBe(de);
  }
  for(const[t,i]of[["job_offers","m3_job_offers_user_status_idx"],["job_offers","m3_job_offers_updated_idx"],["job_offer_generations","m3_gen_offer_idx"],["job_offer_generations","m3_gen_cv_idx"],["job_offer_generations","m3_gen_status_idx"],["ai_runs","m3_ai_runs_offer_idx"],["ai_runs","m3_ai_runs_generation_idx"]]as[string,string][])expect(await hi(conn,t,i)).toBe(true);
  for(const[fk,r]of[["m3_gen_offer_fk","CASCADE"],["m3_gen_cv_fk","SET NULL"],["m3_ai_runs_offer_fk","SET NULL"]]as[string,string][]){
   const[rr]=await conn.query("SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=? AND CONSTRAINT_NAME=?",[DB,fk])as any;
   expect(rr[0].DELETE_RULE).toBe(r);
  }
  const[uk]=await conn.query("SHOW INDEX FROM job_offer_generations WHERE Key_name='m3_gen_offer_request_unique'")as any;
  expect(uk[0].Column_name).toBe("job_offer_id");expect(uk[0].Seq_in_index).toBe(1);expect(uk[0].Non_unique).toBe(0);
  expect(uk[1].Column_name).toBe("generation_request_id");expect(uk[1].Seq_in_index).toBe(2);
  const[us]=await conn.query("SHOW INDEX FROM job_offers WHERE Key_name='m3_job_offers_user_status_idx'")as any;
  expect(us[0].Column_name).toBe("user_id");expect(us[0].Seq_in_index).toBe(1);
  expect(us[1].Column_name).toBe("status");expect(us[1].Seq_in_index).toBe(2);
  const[cnt]=await conn.query("SELECT COUNT(*)AS c FROM job_offer_generations")as any;
  expect(Number(cnt[0].c)).toBe(0);
}

describe("M3 migration 0002",()=>{
  let conn:mysql.Connection,beforeM3:any;
  beforeAll(async()=>{
    conn=await mysql.createConnection({...CFG,multipleStatements:true});
    await conn.query("DROP DATABASE IF EXISTS pocketcv_test");
    await conn.query("CREATE DATABASE pocketcv_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    await conn.query("USE pocketcv_test");
    await applyFile(conn,"0000_funny_tempest.sql");
    await applyFile(conn,"0001_m2_interview.sql");
  });
  afterAll(async()=>{if(conn)await conn.end();});

  it("[RED] M3 structures absent before 0002",async()=>{
    for(const c of["normalized_text","confidence","status","questions_json","selection_json","overrides_json","updated_at"])expect(await hc(conn,"job_offers",c)).toBe(false);
    expect(await ht(conn,"job_offer_generations")).toBe(false);
    for(const c of["job_offer_id","generation_request_id","attempt"])expect(await hc(conn,"ai_runs",c)).toBe(false);
  });

  it("seeds pre-existing data before 0002",async()=>{
    await conn.query("INSERT INTO professional_profile(id,user_id,experiences,education,projects,created_at,updated_at)VALUES('seed-prof','seed-user','[{\"role\":\"dev\"}]','[{\"degree\":\"cs\"}]','[{\"name\":\"pocketcv\"}]','2024-01-01 00:00:00','2024-01-01 00:00:00')");
    await conn.query("INSERT INTO cvs(id,user_id,title,content_json,created_at,updated_at)VALUES('seed-cv','seed-user','test cv','{}','2024-01-01 00:00:00','2024-01-01 00:00:00')");
    await conn.query("INSERT INTO interviews(id,user_id,status,created_at,updated_at,transcript_version)VALUES('seed-int','seed-user','completed','2024-01-01 00:00:00','2024-01-01 00:00:00',0)");
    await conn.query("INSERT INTO job_offers(id,user_id,raw_text,created_at)VALUES('seed-offer-1','seed-user','test offer','2024-01-01 00:00:00')");
    await conn.query("INSERT INTO ai_runs(id,user_id,interview_id,model,task,status,tokens_in,tokens_out,cost_usd,created_at)VALUES('seed-cancelled','seed-user','seed-int','v4-flash','interview-agent','cancelled',0,0,'0','2024-01-01'),('seed-completed','seed-user','seed-int','v4-flash','interview-agent','completed',1,2,'0','2024-01-01')");
    await conn.query("INSERT INTO interview_events(id,interview_id,version,event_type,payload,created_at)VALUES('seed-ev-1','seed-int',1,'question','{\"q\":\"test\"}','2024-01-01 00:00:00')");
  });

  it("captures M1/M2 snapshot before M3",async()=>{beforeM3=await snap(conn);});

  it("[GREEN] after 0002 all M3 structures + data preserve",async()=>{
    await applyFile(conn,"0002_m3_job_offers.sql");
    await assertM3(conn);
    // Forward data assertions: updated_at=created_at, status=draft, attempt=1, new cols null
    const[offers]=await conn.query("SELECT id,user_id,raw_text,created_at,extracted_keywords,detected_category,status,updated_at FROM job_offers WHERE id='seed-offer-1'")as any;
    const o=offers[0];expect(o.id).toBe("seed-offer-1");expect(o.user_id).toBe("seed-user");expect(o.raw_text).toBe("test offer");
    expect(o.extracted_keywords).toBe("[]");expect(o.detected_category).toBeNull();
    expect(o.status).toBe("draft");expect(new Date(o.updated_at).getTime()).toBe(new Date(o.created_at).getTime());
    const[runs]=await conn.query("SELECT id,user_id,status,error,provider_response_id,job_offer_id,generation_request_id,attempt FROM ai_runs ORDER BY id")as any;
    for(const r of runs){expect(r.user_id).toBe("seed-user");expect(r.error).toBeNull();expect(r.provider_response_id).toBeNull();expect(r.job_offer_id).toBeNull();expect(r.generation_request_id).toBeNull();expect(r.attempt).toBe(1);}
    expect(runs[0].status).toBe("cancelled");expect(runs[1].status).toBe("completed");
    // M3 unique constraint rejection
    await expect(conn.query("INSERT INTO job_offer_generations(id,job_offer_id,generation_request_id)VALUES('dup','seed-offer-1','req-1'),('dup2','seed-offer-1','req-1')")).rejects.toThrow();
  });

  it("applies rollback",async()=>{await applyFile(conn,"rollback/0002_m3_job_offers.down.sql");});

  it("[ROLLBACK] afterDown equals beforeM3 exactly",async()=>{
    const afterDown=await snap(conn);
    expect(afterDown).toEqual(beforeM3);
    // Quick M3 absence
    for(const c of["normalized_text","confidence","status","questions_json","selection_json","overrides_json","updated_at"])expect(await hc(conn,"job_offers",c)).toBe(false);
    expect(await ht(conn,"job_offer_generations")).toBe(false);
    for(const c of["job_offer_id","generation_request_id","attempt"])expect(await hc(conn,"ai_runs",c)).toBe(false);
    for(const fk of["m3_gen_offer_fk","m3_gen_cv_fk","m3_ai_runs_offer_fk"])expect(await hf(conn,fk)).toBe(false);
  });

  it("idempotent full re-apply 0000+0001+0002 twice",async()=>{
    await conn.query("DROP DATABASE IF EXISTS pocketcv_test");
    await conn.query("CREATE DATABASE pocketcv_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    await conn.query("USE pocketcv_test");
    await applyFile(conn,"0000_funny_tempest.sql");await applyFile(conn,"0001_m2_interview.sql");await applyFile(conn,"0002_m3_job_offers.sql");await assertM3(conn);
    await applyFile(conn,"0000_funny_tempest.sql");await applyFile(conn,"0001_m2_interview.sql");await applyFile(conn,"0002_m3_job_offers.sql");
    await assertM3(conn);
    for(const t of["job_offers","cvs","ai_runs","interviews","interview_events","professional_profile","job_offer_generations"])expect(await ht(conn,t)).toBe(true);
  });
});
