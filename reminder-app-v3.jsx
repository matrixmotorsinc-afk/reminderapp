import { useState, useEffect, useRef } from "react";

// ── Constants ────────────────────────────────────────
const PRIORITIES = {
  high:   { label:"High",   color:"#ef4444", dim:"#7f1d1d" },
  medium: { label:"Medium", color:"#f59e0b", dim:"#78350f" },
  low:    { label:"Low",    color:"#10b981", dim:"#064e3b" },
};
const REPEAT_OPTIONS = [
  {value:"",       label:"No repeat"},
  {value:"weekly", label:"Weekly"},
  {value:"monthly",label:"Monthly"},
  {value:"yearly", label:"Yearly"},
  {value:"custom", label:"Every X days"},
];
const ADVANCE_OPTIONS = [
  {value:"1hour", label:"1 hour before"},
  {value:"1day",  label:"1 day before"},
  {value:"3days", label:"3 days before"},
  {value:"1week", label:"1 week before"},
];
const BILL_CATS   = ["Rent/Mortgage","Utilities","Phone","Internet","Insurance","Subscription","Credit Card","Loan","Other"];
const APPT_TYPES  = ["Doctor","Dentist","Eye Doctor","Specialist","Lab/Blood Work","Imaging (X-Ray/MRI)","Therapy","Other"];
const FREQ_OPTIONS= ["Once daily","Twice daily","3x daily","Every 4 hours","Every 6 hours","Every 8 hours","Every 12 hours","Weekly","As needed","Other"];

// ── Date helpers (all timezone-safe) ────────────────
function formatDate(ds) {
  if (!ds) return null;
  const [y,m,d] = ds.split("-").map(Number);
  const today = new Date();
  const ty=today.getFullYear(), tm=today.getMonth()+1, td=today.getDate();
  const tom=new Date(); tom.setDate(tom.getDate()+1);
  const oy=tom.getFullYear(), om=tom.getMonth()+1, od=tom.getDate();
  if (y===ty&&m===tm&&d===td) return "Today";
  if (y===oy&&m===om&&d===od) return "Tomorrow";
  const mo=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${mo[m-1]} ${d}, ${y}`;
}
function isOverdue(ds) {
  if (!ds) return false;
  const [y,m,d]=ds.split("-").map(Number);
  const today=new Date();
  const ty=today.getFullYear(),tm=today.getMonth()+1,td=today.getDate();
  if(y!==ty) return y<ty; if(m!==tm) return m<tm; return d<td;
}
function daysUntil(ds) {
  if (!ds) return null;
  const [y,m,d]=ds.split("-").map(Number);
  const target=new Date(y,m-1,d);
  const now=new Date(); const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  return Math.round((target-today)/(1000*60*60*24));
}
function getAdvanceAlert(ds,advance) {
  if (!ds||!advance||advance.length===0) return null;
  const days=daysUntil(ds);
  if (days===null) return null;
  for (const a of advance) {
    if(a==="1hour" &&days===0) return "⏰ 1-hour reminder active";
    if(a==="1day"  &&days===1) return "⏰ Due tomorrow — 1-day notice";
    if(a==="3days" &&days===3) return "⏰ Due in 3 days";
    if(a==="1week" &&days===7) return "⏰ Due in 1 week";
  }
  return null;
}
function nextDueDate(ds,repeat,customDays) {
  if(!ds||!repeat) return ds;
  const [year,month,day]=ds.split("-").map(Number);
  let ny=year,nm=month,nd=day;
  if(repeat==="weekly"){const d=new Date(year,month-1,day+7);ny=d.getFullYear();nm=d.getMonth()+1;nd=d.getDate();}
  if(repeat==="monthly"){nm=month+1;if(nm>12){nm=1;ny=year+1;}const mx=new Date(ny,nm,0).getDate();nd=Math.min(day,mx);}
  if(repeat==="yearly"){ny=year+1;const mx=new Date(ny,nm,0).getDate();nd=Math.min(day,mx);}
  if(repeat==="custom"&&customDays){const d=new Date(year,month-1,day+parseInt(customDays));ny=d.getFullYear();nm=d.getMonth()+1;nd=d.getDate();}
  return `${ny}-${String(nm).padStart(2,"0")}-${String(nd).padStart(2,"0")}`;
}
function repeatDescription(ds,repeat,customDays) {
  if(!repeat||!ds) return "";
  const [,m,d]=ds.split("-").map(Number);
  const sfx=d===1?"st":d===2?"nd":d===3?"rd":"th";
  const mName=["January","February","March","April","May","June","July","August","September","October","November","December"][m-1];
  if(repeat==="weekly")  return "Every week";
  if(repeat==="monthly") return `${d}${sfx} of every month`;
  if(repeat==="yearly")  return `Every year on ${mName} ${d}`;
  if(repeat==="custom"&&customDays) return `Every ${customDays} days`;
  return "";
}
function uid(){return Date.now()+"-"+Math.random().toString(36).slice(2);}

// ── Default form states ──────────────────────────────
const emptyR={title:"",note:"",dueDate:"",priority:"medium",advance:[]};
const emptyB={title:"",category:"Utilities",amount:"",dueDate:"",repeat:"monthly",customDays:"",advance:["1day","3days"],note:""};
const emptyA={type:"Doctor",doctorName:"",date:"",time:"",location:"",reason:"",diagnosis:"",notes:"",followUp:""};
const emptyM={name:"",dosage:"",frequency:"Once daily",doctor:"",startDate:"",endDate:"",refillDate:"",advance:["3days"],notes:""};

// ══════════════════════════════════════════════════════
export default function ReminderApp() {
  const [tab,setTab]           = useState("reminders");
  const [reminders,setReminders]=useState([]);
  const [bills,setBills]       = useState([]);
  const [appts,setAppts]       = useState([]);
  const [meds,setMeds]         = useState([]);
  const [loading,setLoading]   = useState(true);
  const [showForm,setShowForm] = useState(false);
  const [showDetail,setShowDetail]=useState(null); // appointment detail view
  const [editId,setEditId]     = useState(null);
  const [rForm,setRForm]       = useState(emptyR);
  const [bForm,setBForm]       = useState(emptyB);
  const [aForm,setAForm]       = useState(emptyA);
  const [mForm,setMForm]       = useState(emptyM);
  const [filter,setFilter]     = useState("Active");
  const [search,setSearch]     = useState("");
  const titleRef=useRef(null);

  // Storage
  useEffect(()=>{
    (async()=>{
      try {
        const r=await window.storage.get("woa_reminders");
        const b=await window.storage.get("woa_bills");
        const a=await window.storage.get("woa_appts");
        const m=await window.storage.get("woa_meds");
        if(r) setReminders(JSON.parse(r.value));
        if(b) setBills(JSON.parse(b.value));
        if(a) setAppts(JSON.parse(a.value));
        if(m) setMeds(JSON.parse(m.value));
      } catch{}
      setLoading(false);
    })();
  },[]);
  useEffect(()=>{if(!loading)window.storage.set("woa_reminders",JSON.stringify(reminders));},[reminders,loading]);
  useEffect(()=>{if(!loading)window.storage.set("woa_bills",JSON.stringify(bills));},[bills,loading]);
  useEffect(()=>{if(!loading)window.storage.set("woa_appts",JSON.stringify(appts));},[appts,loading]);
  useEffect(()=>{if(!loading)window.storage.set("woa_meds",JSON.stringify(meds));},[meds,loading]);
  useEffect(()=>{if(showForm&&titleRef.current)titleRef.current.focus();},[showForm]);

  // ── Reminder CRUD ──
  const openNewR =()=>{setRForm(emptyR);setEditId(null);setShowForm(true);};
  const openEditR=r=>{setRForm({title:r.title,note:r.note||"",dueDate:r.dueDate||"",priority:r.priority,advance:r.advance||[]});setEditId(r.id);setShowForm(true);};
  const saveR=()=>{
    if(!rForm.title.trim())return;
    if(editId)setReminders(rs=>rs.map(r=>r.id===editId?{...r,...rForm}:r));
    else setReminders(rs=>[...rs,{id:uid(),...rForm,completed:false,createdAt:new Date().toISOString()}]);
    setShowForm(false);
  };
  const toggleR=id=>setReminders(rs=>rs.map(r=>r.id===id?{...r,completed:!r.completed}:r));
  const deleteR=id=>setReminders(rs=>rs.filter(r=>r.id!==id));

  // ── Bill CRUD ──
  const openNewB =()=>{setBForm(emptyB);setEditId(null);setShowForm(true);};
  const openEditB=b=>{setBForm({title:b.title,category:b.category,amount:b.amount||"",dueDate:b.dueDate||"",repeat:b.repeat||"monthly",customDays:b.customDays||"",advance:b.advance||["1day","3days"],note:b.note||""});setEditId(b.id);setShowForm(true);};
  const saveB=()=>{
    if(!bForm.title.trim()||!bForm.dueDate)return;
    if(editId)setBills(bs=>bs.map(b=>b.id===editId?{...b,...bForm}:b));
    else setBills(bs=>[...bs,{id:uid(),...bForm,paid:false,createdAt:new Date().toISOString()}]);
    setShowForm(false);
  };
  const markPaid=id=>{
    setBills(bs=>bs.map(b=>{
      if(b.id!==id)return b;
      if(b.repeat)return{...b,dueDate:nextDueDate(b.dueDate,b.repeat,b.customDays),lastPaid:new Date().toISOString()};
      return{...b,paid:true,lastPaid:new Date().toISOString()};
    }));
  };
  const deleteB=id=>setBills(bs=>bs.filter(b=>b.id!==id));

  // ── Appointment CRUD ──
  const openNewA =()=>{setAForm(emptyA);setEditId(null);setShowForm(true);};
  const openEditA=a=>{setAForm({type:a.type,doctorName:a.doctorName||"",date:a.date||"",time:a.time||"",location:a.location||"",reason:a.reason||"",diagnosis:a.diagnosis||"",notes:a.notes||"",followUp:a.followUp||""});setEditId(a.id);setShowForm(true);};
  const saveA=()=>{
    if(!aForm.doctorName.trim()||!aForm.date)return;
    if(editId)setAppts(as=>as.map(a=>a.id===editId?{...a,...aForm}:a));
    else setAppts(as=>[...as,{id:uid(),...aForm,createdAt:new Date().toISOString()}]);
    setShowForm(false);
  };
  const deleteA=id=>setAppts(as=>as.filter(a=>a.id!==id));

  // ── Medication CRUD ──
  const openNewM =()=>{setMForm(emptyM);setEditId(null);setShowForm(true);};
  const openEditM=m=>{setMForm({name:m.name,dosage:m.dosage||"",frequency:m.frequency||"Once daily",doctor:m.doctor||"",startDate:m.startDate||"",endDate:m.endDate||"",refillDate:m.refillDate||"",advance:m.advance||["3days"],notes:m.notes||""});setEditId(m.id);setShowForm(true);};
  const saveM=()=>{
    if(!mForm.name.trim())return;
    if(editId)setMeds(ms=>ms.map(m=>m.id===editId?{...m,...mForm}:m));
    else setMeds(ms=>[...ms,{id:uid(),...mForm,active:true,createdAt:new Date().toISOString()}]);
    setShowForm(false);
  };
  const toggleMed=id=>setMeds(ms=>ms.map(m=>m.id===id?{...m,active:!m.active}:m));
  const deleteM=id=>setMeds(ms=>ms.filter(m=>m.id!==id));

  // ── Filtered lists ──
  const filtR=reminders.filter(r=>{
    const mf=filter==="All"||(filter==="Active"?!r.completed:r.completed);
    return mf&&r.title.toLowerCase().includes(search.toLowerCase());
  }).sort((a,b)=>{
    if(a.completed!==b.completed)return a.completed?1:-1;
    return ({high:0,medium:1,low:2}[a.priority])-({high:0,medium:1,low:2}[b.priority]);
  });
  const filtB=bills.filter(b=>{
    const mf=filter==="All"||(filter==="Active"?!b.paid:b.paid);
    return mf&&b.title.toLowerCase().includes(search.toLowerCase());
  }).sort((a,b)=>(!a.dueDate?1:!b.dueDate?-1:new Date(a.dueDate)-new Date(b.dueDate)));
  const filtA=appts.filter(a=>
    a.doctorName.toLowerCase().includes(search.toLowerCase())||
    a.type.toLowerCase().includes(search.toLowerCase())
  ).sort((a,b)=>(!a.date?1:!b.date?-1:a.date.localeCompare(b.date)));
  const filtM=meds.filter(m=>{
    const mf=filter==="All"||(filter==="Active"?m.active:!m.active);
    return mf&&m.name.toLowerCase().includes(search.toLowerCase());
  });

  const counts={
    reminders:{All:reminders.length,Active:reminders.filter(r=>!r.completed).length,Completed:reminders.filter(r=>r.completed).length},
    bills:{All:bills.length,Active:bills.filter(b=>!b.paid).length,Completed:bills.filter(b=>b.paid).length},
    appointments:{All:appts.length,Active:appts.filter(a=>!isOverdue(a.date)).length,Completed:appts.filter(a=>isOverdue(a.date)).length},
    medications:{All:meds.length,Active:meds.filter(m=>m.active).length,Completed:meds.filter(m=>!m.active).length},
  };

  const rAlerts=reminders.filter(r=>!r.completed&&r.dueDate&&(isOverdue(r.dueDate)||getAdvanceAlert(r.dueDate,r.advance))).length;
  const bAlerts=bills.filter(b=>!b.paid&&b.dueDate&&(isOverdue(b.dueDate)||getAdvanceAlert(b.dueDate,b.advance))).length;
  const aAlerts=appts.filter(a=>a.date&&daysUntil(a.date)!==null&&daysUntil(a.date)>=0&&daysUntil(a.date)<=3).length;
  const mAlerts=meds.filter(m=>m.active&&m.refillDate&&getAdvanceAlert(m.refillDate,m.advance)).length;

  const IS={width:"100%",background:"#0f0e17",border:"1px solid #2a2940",borderRadius:10,padding:"11px 14px",color:"#fffffe",fontSize:14,outline:"none",fontFamily:"inherit"};
  const LS={fontSize:10,color:"#5a5a7a",marginBottom:5,letterSpacing:2,textTransform:"uppercase",display:"block"};
  const tabColor={reminders:"#f25f4c",bills:"#10b981",appointments:"#38bdf8",medications:"#a78bfa"};
  const activeColor=tabColor[tab];

  const TABS=[
    ["reminders","🔔","Reminders",rAlerts],
    ["bills","💳","Bills",bAlerts],
    ["appointments","🏥","Appts",aAlerts],
    ["medications","💊","Meds",mAlerts],
  ];

  // Appointment type icons
  const apptIcon={Doctor:"👨⚕️",Dentist:"🦷","Eye Doctor":"👁️",Specialist:"🔬","Lab/Blood Work":"🩸","Imaging (X-Ray/MRI)":"🩻",Therapy:"🧠",Other:"🏥"};

  return (
    <div style={{minHeight:"100vh",background:"#0f0e17",fontFamily:"'Georgia','Times New Roman',serif",color:"#fffffe"}}>
      <style>{`
        *{box-sizing:border-box;}::placeholder{color:#4a4a6a;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-thumb{background:#2a2940;border-radius:3px;}
        input,textarea,select{font-family:inherit;}select option{background:#0f0e17;}
        .card{transition:background 0.18s;}.card:hover{background:#1a1a2e!important;}
        .del{opacity:0;transition:opacity 0.15s;}.card:hover .del{opacity:1;}
        .btn{transition:all 0.18s;cursor:pointer;}.btn:hover{filter:brightness(1.15);}.btn:active{transform:scale(0.97);}
        .pill{transition:all 0.15s;cursor:pointer;}.pill:hover{filter:brightness(1.2);}
        .fade{animation:fadeUp 0.22s ease forwards;}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .modal-bg{animation:mbg 0.15s ease;}@keyframes mbg{from{opacity:0}to{opacity:1}}
        .modal-box{animation:mbox 0.22s cubic-bezier(0.34,1.4,0.64,1);}
        @keyframes mbox{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}
        .pulse{animation:pulse 3s ease-in-out infinite;}
        @keyframes pulse{0%,100%{opacity:0.4}50%{opacity:0.7}}
        .adot{animation:adot 1.5s ease-in-out infinite;}
        @keyframes adot{0%,100%{transform:scale(1)}50%{transform:scale(1.6);opacity:0.4}}
      `}</style>

      {/* HEADER */}
      <div style={{borderBottom:"1px solid #1a1a2e",padding:"20px 20px 0"}}>
        <div style={{maxWidth:680,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div>
              <div style={{fontSize:10,letterSpacing:4,color:"#ff8906",textTransform:"uppercase",marginBottom:3}}>Your Space</div>
              <h1 style={{margin:0,fontSize:24,fontWeight:400,letterSpacing:-1}}>
                {tab==="reminders"?"Reminders":tab==="bills"?"Bills & Payments":tab==="appointments"?"Doctor & Lab Appointments":"Medications"}
              </h1>
            </div>
            <button onClick={tab==="reminders"?openNewR:tab==="bills"?openNewB:tab==="appointments"?openNewA:openNewM}
              className="btn" style={{background:activeColor,border:"none",borderRadius:"50%",width:42,height:42,color:"#fff",fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 18px ${activeColor}66`}}>+</button>
          </div>
          {/* Tabs */}
          <div style={{display:"flex"}}>
            {TABS.map(([t,icon,lbl,al])=>(
              <button key={t} onClick={()=>{setTab(t);setFilter("Active");setSearch("");setShowForm(false);setShowDetail(null);}}
                style={{flex:1,background:"transparent",border:"none",borderBottom:`2px solid ${tab===t?tabColor[t]:"transparent"}`,padding:"10px 0",color:tab===t?"#fffffe":"#5a5a7a",fontSize:11,cursor:"pointer",fontFamily:"inherit",transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                <span style={{fontSize:14}}>{icon}</span>
                <span style={{display:"none",["@media(min-width:400px)"]:{display:"inline"}}}>{lbl}</span>
                {al>0&&<span className="adot" style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#ef4444"}}/>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SEARCH + FILTERS */}
      <div style={{maxWidth:680,margin:"0 auto",padding:"14px 20px 0"}}>
        <div style={{position:"relative",marginBottom:10}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#4a4a6a",fontSize:13}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={{...IS,paddingLeft:34,borderRadius:12}}/>
        </div>
        {tab!=="appointments"&&(
          <div style={{display:"flex",gap:4,marginBottom:14}}>
            {["Active","All","Completed"].map(f=>(
              <button key={f} onClick={()=>setFilter(f)} className="pill"
                style={{background:filter===f?"#2a2940":"transparent",border:"none",borderRadius:8,padding:"5px 12px",color:filter===f?"#fffffe":"#5a5a7a",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                {f} <span style={{fontSize:10,opacity:0.7}}>{counts[tab]?.[f]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* LISTS */}
      <div style={{maxWidth:680,margin:"0 auto",padding:"0 20px 80px"}}>
        {loading?(
          <div style={{textAlign:"center",padding:60,color:"#4a4a6a"}}>Loading…</div>

        // ── REMINDERS ──
        ):tab==="reminders"?(
          filtR.length===0?(
            <div className="pulse" style={{textAlign:"center",padding:"60px 0",color:"#4a4a6a"}}>
              <div style={{fontSize:40,marginBottom:8}}>○</div>
              <div style={{fontSize:14}}>{search?"No matches":filter==="Completed"?"Nothing completed yet":"No reminders — tap + to add one"}</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filtR.map(r=>{
                const p=PRIORITIES[r.priority];
                const over=!r.completed&&isOverdue(r.dueDate);
                const adv=!r.completed&&getAdvanceAlert(r.dueDate,r.advance);
                return(
                  <div key={r.id} className="card fade" style={{background:"#13131f",border:`1px solid ${over?"#7f1d1d":r.completed?"#1a1a2e":"#2a2940"}`,borderLeft:`3px solid ${r.completed?"#2a2940":p.color}`,borderRadius:12,padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start",opacity:r.completed?0.5:1}}>
                    <button onClick={()=>toggleR(r.id)} className="btn" style={{width:22,height:22,borderRadius:"50%",flexShrink:0,marginTop:2,border:`2px solid ${r.completed?p.color:"#2a2940"}`,background:r.completed?p.color:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11}}>{r.completed&&"✓"}</button>
                    <div style={{flex:1,minWidth:0,cursor:r.completed?"default":"pointer"}} onClick={()=>!r.completed&&openEditR(r)}>
                      <div style={{fontSize:15,textDecoration:r.completed?"line-through":"none",color:r.completed?"#5a5a7a":"#fffffe",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:3}}>{r.title}</div>
                      {r.note&&<div style={{fontSize:12,color:"#5a5a7a",marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{r.note}</div>}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                        <span style={{fontSize:11,color:p.color,background:p.dim+"55",padding:"2px 8px",borderRadius:20}}>{p.label}</span>
                        {r.dueDate&&<span style={{fontSize:11,color:over?"#ef4444":"#5a5a7a"}}>{over?"⚠ Overdue · ":""}{formatDate(r.dueDate)}</span>}
                        {adv&&<span style={{fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,0.12)",padding:"2px 8px",borderRadius:20}}>{adv}</span>}
                      </div>
                      {(r.advance||[]).length>0&&!r.completed&&r.dueDate&&<div style={{fontSize:10,color:"#3a3a5a",marginTop:3}}>🔔 {r.advance.map(a=>ADVANCE_OPTIONS.find(x=>x.value===a)?.label).join(" · ")}</div>}
                    </div>
                    <button onClick={()=>deleteR(r.id)} className="del btn" style={{background:"none",border:"none",color:"#4a4a6a",cursor:"pointer",fontSize:18,padding:2,lineHeight:1}}>×</button>
                  </div>
                );
              })}
            </div>
          )

        // ── BILLS ──
        ):tab==="bills"?(
          filtB.length===0?(
            <div className="pulse" style={{textAlign:"center",padding:"60px 0",color:"#4a4a6a"}}>
              <div style={{fontSize:40,marginBottom:8}}>💳</div>
              <div style={{fontSize:14}}>{search?"No matches":filter==="Completed"?"No paid bills":"No bills — tap + to add one"}</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filtB.map(b=>{
                const over=!b.paid&&isOverdue(b.dueDate);
                const days=daysUntil(b.dueDate);
                const urgent=!b.paid&&days!==null&&days<=3&&days>=0;
                const adv=!b.paid&&getAdvanceAlert(b.dueDate,b.advance);
                return(
                  <div key={b.id} className="card fade" style={{background:"#13131f",border:`1px solid ${over?"#7f1d1d":urgent?"#78350f":b.paid?"#1a1a2e":"#2a2940"}`,borderLeft:`3px solid ${b.paid?"#2a2940":over?"#ef4444":urgent?"#f59e0b":"#10b981"}`,borderRadius:12,padding:"12px 14px",opacity:b.paid?0.5:1}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <button onClick={()=>markPaid(b.id)} className="btn" style={{width:22,height:22,borderRadius:"50%",flexShrink:0,marginTop:2,border:`2px solid ${b.paid?"#10b981":"#2a2940"}`,background:b.paid?"#10b981":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11}}>{b.paid&&"✓"}</button>
                      <div style={{flex:1,minWidth:0,cursor:b.paid?"default":"pointer"}} onClick={()=>!b.paid&&openEditB(b)}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                          <div style={{fontSize:15,textDecoration:b.paid?"line-through":"none",color:b.paid?"#5a5a7a":"#fffffe",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1}}>{b.title}</div>
                          {b.amount&&<div style={{fontSize:16,fontWeight:600,color:b.paid?"#5a5a7a":over?"#ef4444":"#fffffe",marginLeft:10,flexShrink:0}}>${parseFloat(b.amount).toFixed(2)}</div>}
                        </div>
                        <div style={{fontSize:11,color:"#5a5a7a",marginBottom:4}}>{b.category}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                          {b.dueDate&&<span style={{fontSize:11,color:over?"#ef4444":urgent?"#f59e0b":"#5a5a7a"}}>{over?"⚠ Overdue · ":urgent?"⚡ Due soon · ":""}{formatDate(b.dueDate)}</span>}
                          {b.repeat&&<span style={{fontSize:10,color:"#a78bfa",background:"rgba(167,139,250,0.12)",padding:"2px 7px",borderRadius:20}}>🔄 {repeatDescription(b.dueDate,b.repeat,b.customDays)}</span>}
                          {adv&&<span style={{fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,0.12)",padding:"2px 8px",borderRadius:20}}>{adv}</span>}
                        </div>
                        {(b.advance||[]).length>0&&!b.paid&&<div style={{fontSize:10,color:"#3a3a5a",marginTop:3}}>🔔 {b.advance.map(a=>ADVANCE_OPTIONS.find(x=>x.value===a)?.label).join(" · ")}</div>}
                        {b.note&&<div style={{fontSize:12,color:"#5a5a7a",marginTop:4}}>{b.note}</div>}
                      </div>
                      <button onClick={()=>deleteB(b.id)} className="del btn" style={{background:"none",border:"none",color:"#4a4a6a",cursor:"pointer",fontSize:18,padding:2,lineHeight:1}}>×</button>
                    </div>
                    {!b.paid&&(
                      <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #1a1a2e",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{fontSize:11,color:"#4a4a6a"}}>{b.repeat?`Next after paying: ${formatDate(nextDueDate(b.dueDate,b.repeat,b.customDays))}`:"One-time payment"}</span>
                        <button onClick={()=>markPaid(b.id)} className="btn" style={{background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:8,padding:"4px 12px",color:"#10b981",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Mark Paid</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )

        // ── APPOINTMENTS ──
        ):tab==="appointments"?(
          showDetail?(
            // ── APPOINTMENT DETAIL VIEW ──
            <div className="fade">
              <button onClick={()=>setShowDetail(null)} style={{background:"transparent",border:"none",color:"#5a5a7a",cursor:"pointer",fontFamily:"inherit",fontSize:13,marginBottom:16,padding:0,display:"flex",alignItems:"center",gap:6}}>← Back to Appointments</button>
              <div style={{background:"#13131f",border:`1px solid ${tabColor.appointments}44`,borderRadius:16,padding:"20px",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                  <div style={{display:"flex",gap:12,alignItems:"center"}}>
                    <div style={{fontSize:32}}>{apptIcon[showDetail.type]||"🏥"}</div>
                    <div>
                      <div style={{fontSize:18,fontWeight:600,color:"#fffffe"}}>{showDetail.doctorName}</div>
                      <div style={{fontSize:12,color:tabColor.appointments}}>{showDetail.type}</div>
                    </div>
                  </div>
                  <button onClick={()=>{openEditA(showDetail);setShowDetail(null);}} style={{background:"rgba(56,189,248,0.1)",border:"1px solid rgba(56,189,248,0.3)",borderRadius:8,padding:"5px 12px",color:tabColor.appointments,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                  {[
                    ["📅 Date",showDetail.date?`${formatDate(showDetail.date)}${showDetail.time?" at "+showDetail.time:""}`:null],
                    ["📍 Location",showDetail.location],
                    ["🩺 Reason",showDetail.reason],
                    ["📋 Follow-Up",showDetail.followUp?formatDate(showDetail.followUp):null],
                  ].filter(([,v])=>v).map(([label,val])=>(
                    <div key={label} style={{background:"#0f0e17",borderRadius:10,padding:"10px 12px"}}>
                      <div style={{fontSize:10,color:"#5a5a7a",letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                      <div style={{fontSize:13,color:"#fffffe"}}>{val}</div>
                    </div>
                  ))}
                </div>
                {showDetail.diagnosis&&(
                  <div style={{background:"rgba(56,189,248,0.07)",border:"1px solid rgba(56,189,248,0.2)",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                    <div style={{fontSize:10,color:tabColor.appointments,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>🔬 Diagnosis</div>
                    <div style={{fontSize:14,color:"#fffffe",lineHeight:1.6}}>{showDetail.diagnosis}</div>
                  </div>
                )}
                {showDetail.notes&&(
                  <div style={{background:"#0f0e17",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                    <div style={{fontSize:10,color:"#5a5a7a",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>📝 Notes from Visit</div>
                    <div style={{fontSize:13,color:"#c0c0e0",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{showDetail.notes}</div>
                  </div>
                )}
                {showDetail.followUp&&(
                  <div style={{background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.2)",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{fontSize:12,color:"#f59e0b"}}>📅 Follow-up appointment: <strong>{formatDate(showDetail.followUp)}</strong></div>
                  </div>
                )}
              </div>
            </div>
          ):(
            filtA.length===0?(
              <div className="pulse" style={{textAlign:"center",padding:"60px 0",color:"#4a4a6a"}}>
                <div style={{fontSize:40,marginBottom:8}}>🏥</div>
                <div style={{fontSize:14}}>{search?"No matches":"No appointments — tap + to add one"}</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {filtA.map(a=>{
                  const over=isOverdue(a.date);
                  const days=daysUntil(a.date);
                  const soon=days!==null&&days>=0&&days<=3;
                  return(
                    <div key={a.id} className="card fade" style={{background:"#13131f",border:`1px solid ${soon?"rgba(56,189,248,0.3)":over?"#1a1a2e":"#2a2940"}`,borderLeft:`3px solid ${over?"#2a2940":soon?tabColor.appointments:"#2a2940"}`,borderRadius:12,padding:"12px 14px",opacity:over?0.6:1,cursor:"pointer"}} onClick={()=>setShowDetail(a)}>
                      <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                        <div style={{fontSize:24,flexShrink:0}}>{apptIcon[a.type]||"🏥"}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                            <div style={{fontSize:15,color:"#fffffe",fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{a.doctorName}</div>
                            {soon&&<span style={{fontSize:10,color:tabColor.appointments,background:"rgba(56,189,248,0.12)",padding:"2px 8px",borderRadius:20,flexShrink:0,marginLeft:8}}>🗓 {days===0?"Today":days===1?"Tomorrow":`In ${days} days`}</span>}
                          </div>
                          <div style={{fontSize:11,color:tabColor.appointments,marginBottom:4}}>{a.type}</div>
                          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                            {a.date&&<span style={{fontSize:11,color:over?"#5a5a7a":"#fffffe"}}>{formatDate(a.date)}{a.time&&" · "+a.time}</span>}
                            {a.location&&<span style={{fontSize:11,color:"#5a5a7a"}}>📍 {a.location}</span>}
                          </div>
                          {a.reason&&<div style={{fontSize:11,color:"#5a5a7a",marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Reason: {a.reason}</div>}
                          {a.diagnosis&&<div style={{fontSize:11,color:"#38bdf8",marginTop:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>Dx: {a.diagnosis}</div>}
                          {(a.notes||a.followUp)&&(
                            <div style={{display:"flex",gap:8,marginTop:4}}>
                              {a.notes&&<span style={{fontSize:10,color:"#5a5a7a",background:"#1a1a2e",padding:"2px 7px",borderRadius:10}}>📝 Notes</span>}
                              {a.followUp&&<span style={{fontSize:10,color:"#f59e0b",background:"rgba(245,158,11,0.1)",padding:"2px 7px",borderRadius:10}}>↩ Follow-up: {formatDate(a.followUp)}</span>}
                            </div>
                          )}
                        </div>
                        <button onClick={e=>{e.stopPropagation();deleteA(a.id);}} className="del btn" style={{background:"none",border:"none",color:"#4a4a6a",cursor:"pointer",fontSize:18,padding:2,lineHeight:1}}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )

        // ── MEDICATIONS ──
        ):(
          filtM.length===0?(
            <div className="pulse" style={{textAlign:"center",padding:"60px 0",color:"#4a4a6a"}}>
              <div style={{fontSize:40,marginBottom:8}}>💊</div>
              <div style={{fontSize:14}}>{search?"No matches":filter==="Completed"?"No inactive medications":"No medications — tap + to add one"}</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filtM.map(m=>{
                const refillAdv=m.active&&getAdvanceAlert(m.refillDate,m.advance);
                const refillOver=m.active&&isOverdue(m.refillDate);
                return(
                  <div key={m.id} className="card fade" style={{background:"#13131f",border:`1px solid ${!m.active?"#1a1a2e":refillOver||refillAdv?"rgba(167,139,250,0.35)":"#2a2940"}`,borderLeft:`3px solid ${!m.active?"#2a2940":"#a78bfa"}`,borderRadius:12,padding:"12px 14px",opacity:m.active?1:0.5}}>
                    <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                      <div style={{fontSize:24,flexShrink:0}}>💊</div>
                      <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>openEditM(m)}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                          <div style={{fontSize:15,color:"#fffffe",fontWeight:500}}>{m.name}</div>
                          <span style={{fontSize:11,color:m.active?"#a78bfa":"#5a5a7a",background:m.active?"rgba(167,139,250,0.12)":"#1a1a2e",padding:"2px 8px",borderRadius:20,flexShrink:0,marginLeft:8}}>{m.active?"Active":"Inactive"}</span>
                        </div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4}}>
                          {m.dosage&&<span style={{fontSize:12,color:"#fffffe"}}>{m.dosage}</span>}
                          {m.frequency&&<span style={{fontSize:12,color:"#5a5a7a"}}>· {m.frequency}</span>}
                        </div>
                        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                          {m.doctor&&<span style={{fontSize:11,color:"#5a5a7a"}}>👨⚕️ Dr. {m.doctor}</span>}
                          {m.startDate&&<span style={{fontSize:11,color:"#5a5a7a"}}>Started: {formatDate(m.startDate)}</span>}
                          {m.endDate&&<span style={{fontSize:11,color:"#5a5a7a"}}>Ends: {formatDate(m.endDate)}</span>}
                        </div>
                        {m.refillDate&&m.active&&(
                          <div style={{marginTop:4}}>
                            <span style={{fontSize:11,color:refillOver?"#ef4444":refillAdv?"#f59e0b":"#5a5a7a"}}>
                              {refillOver?"⚠ Refill overdue · ":refillAdv?"⏰ Refill soon · ":"💊 Refill: "}{formatDate(m.refillDate)}
                            </span>
                          </div>
                        )}
                        {refillAdv&&<span style={{fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,0.1)",padding:"2px 8px",borderRadius:20,marginTop:4,display:"inline-block"}}>{refillAdv}</span>}
                        {m.notes&&<div style={{fontSize:11,color:"#5a5a7a",marginTop:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.notes}</div>}
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"center"}}>
                        <button onClick={()=>toggleMed(m.id)} className="btn" style={{background:m.active?"rgba(167,139,250,0.15)":"#1a1a2e",border:`1px solid ${m.active?"#a78bfa":"#2a2940"}`,borderRadius:8,padding:"4px 8px",color:m.active?"#a78bfa":"#5a5a7a",fontSize:10,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>{m.active?"Active":"Inactive"}</button>
                        <button onClick={()=>deleteM(m.id)} className="del btn" style={{background:"none",border:"none",color:"#4a4a6a",cursor:"pointer",fontSize:18,padding:2,lineHeight:1}}>×</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* MODAL */}
      {showForm&&(
        <div className="modal-bg" onClick={()=>setShowForm(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:200,overflowY:"auto"}}>
          <div className="modal-box" onClick={e=>e.stopPropagation()} style={{background:"#13131f",border:`1px solid ${activeColor}44`,borderRadius:20,padding:"22px 20px",width:"100%",maxWidth:480,maxHeight:"90vh",overflowY:"auto"}}>

            {/* ── REMINDER FORM ── */}
            {tab==="reminders"&&(
              <>
                <div style={{fontSize:18,fontWeight:400,marginBottom:18,color:activeColor}}>{editId?"Edit Reminder":"New Reminder"}</div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <input ref={titleRef} value={rForm.title} onChange={e=>setRForm(f=>({...f,title:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveR()} placeholder="What do you need to remember?" style={IS}/>
                  <textarea value={rForm.note} onChange={e=>setRForm(f=>({...f,note:e.target.value}))} placeholder="Add a note… (optional)" rows={2} style={{...IS,resize:"none"}}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={LS}>Due Date</label><input type="date" value={rForm.dueDate} onChange={e=>setRForm(f=>({...f,dueDate:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                    <div><label style={LS}>Priority</label>
                      <select value={rForm.priority} onChange={e=>setRForm(f=>({...f,priority:e.target.value}))} style={IS}>
                        {Object.entries(PRIORITIES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {rForm.dueDate&&(
                    <div>
                      <label style={LS}>🔔 Remind Me Before</label>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {ADVANCE_OPTIONS.map(a=>{const on=(rForm.advance||[]).includes(a.value);return(
                          <button key={a.value} onClick={()=>setRForm(f=>({...f,advance:on?f.advance.filter(x=>x!==a.value):[...f.advance,a.value]}))} className="pill" style={{padding:"5px 11px",borderRadius:20,fontSize:12,border:`1px solid ${on?"#f59e0b":"#2a2940"}`,background:on?"rgba(245,158,11,0.15)":"transparent",color:on?"#f59e0b":"#5a5a7a",cursor:"pointer",fontFamily:"inherit"}}>{a.label}</button>
                        );})}
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",gap:10,marginTop:4}}>
                    <button onClick={()=>setShowForm(false)} style={{flex:1,background:"transparent",border:"1px solid #2a2940",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                    <button onClick={saveR} className="btn" style={{flex:1,background:rForm.title.trim()?activeColor:"#2a2940",border:"none",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,fontFamily:"inherit"}}>{editId?"Save":"Add Reminder"}</button>
                  </div>
                </div>
              </>
            )}

            {/* ── BILL FORM ── */}
            {tab==="bills"&&(
              <>
                <div style={{fontSize:18,fontWeight:400,marginBottom:18,color:activeColor}}>{editId?"Edit Bill":"New Bill"}</div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <input ref={titleRef} value={bForm.title} onChange={e=>setBForm(f=>({...f,title:e.target.value}))} placeholder="Bill name" style={IS}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={LS}>Category</label><select value={bForm.category} onChange={e=>setBForm(f=>({...f,category:e.target.value}))} style={IS}>{BILL_CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                    <div><label style={LS}>Amount ($)</label><input type="number" value={bForm.amount} onChange={e=>setBForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" min="0" step="0.01" style={IS}/></div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={LS}>Due Date</label><input type="date" value={bForm.dueDate} onChange={e=>setBForm(f=>({...f,dueDate:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                    <div><label style={LS}>Repeats</label><select value={bForm.repeat} onChange={e=>setBForm(f=>({...f,repeat:e.target.value}))} style={IS}>{REPEAT_OPTIONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
                  </div>
                  {bForm.repeat==="custom"&&<div><label style={LS}>Every (days)</label><input type="number" value={bForm.customDays} onChange={e=>setBForm(f=>({...f,customDays:e.target.value}))} placeholder="e.g. 14" min="1" style={IS}/></div>}
                  <div>
                    <label style={LS}>🔔 Remind Me Before</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                      {ADVANCE_OPTIONS.map(a=>{const on=(bForm.advance||[]).includes(a.value);return(
                        <button key={a.value} onClick={()=>setBForm(f=>({...f,advance:on?f.advance.filter(x=>x!==a.value):[...f.advance,a.value]}))} className="pill" style={{padding:"5px 11px",borderRadius:20,fontSize:12,border:`1px solid ${on?"#f59e0b":"#2a2940"}`,background:on?"rgba(245,158,11,0.15)":"transparent",color:on?"#f59e0b":"#5a5a7a",cursor:"pointer",fontFamily:"inherit"}}>{a.label}</button>
                      );})}
                    </div>
                  </div>
                  {bForm.dueDate&&bForm.repeat&&<div style={{background:"rgba(167,139,250,0.08)",border:"1px solid rgba(167,139,250,0.2)",borderRadius:10,padding:"9px 13px",fontSize:12,color:"#a78bfa"}}>🔄 {repeatDescription(bForm.dueDate,bForm.repeat,bForm.customDays)} · Next: <strong>{formatDate(nextDueDate(bForm.dueDate,bForm.repeat,bForm.customDays))}</strong></div>}
                  <textarea value={bForm.note} onChange={e=>setBForm(f=>({...f,note:e.target.value}))} placeholder="Notes… (optional)" rows={2} style={{...IS,resize:"none"}}/>
                  <div style={{display:"flex",gap:10,marginTop:4}}>
                    <button onClick={()=>setShowForm(false)} style={{flex:1,background:"transparent",border:"1px solid #2a2940",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                    <button onClick={saveB} className="btn" style={{flex:1,background:bForm.title.trim()&&bForm.dueDate?activeColor:"#2a2940",border:"none",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,fontFamily:"inherit"}}>{editId?"Save":"Add Bill"}</button>
                  </div>
                </div>
              </>
            )}

            {/* ── APPOINTMENT FORM ── */}
            {tab==="appointments"&&(
              <>
                <div style={{fontSize:18,fontWeight:400,marginBottom:18,color:activeColor}}>{editId?"Edit Appointment":"New Appointment"}</div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div><label style={LS}>Appointment Type</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                      {APPT_TYPES.map(t=>{const on=aForm.type===t;return(
                        <button key={t} onClick={()=>setAForm(f=>({...f,type:t}))} className="pill" style={{padding:"5px 10px",borderRadius:20,fontSize:12,border:`1px solid ${on?tabColor.appointments:"#2a2940"}`,background:on?"rgba(56,189,248,0.15)":"transparent",color:on?tabColor.appointments:"#5a5a7a",cursor:"pointer",fontFamily:"inherit"}}>{apptIcon[t]} {t}</button>
                      );})}
                    </div>
                  </div>
                  <div><label style={LS}>Doctor / Provider Name</label><input ref={titleRef} value={aForm.doctorName} onChange={e=>setAForm(f=>({...f,doctorName:e.target.value}))} placeholder="e.g. Dr. Smith" style={IS}/></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={LS}>Date</label><input type="date" value={aForm.date} onChange={e=>setAForm(f=>({...f,date:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                    <div><label style={LS}>Time</label><input type="time" value={aForm.time} onChange={e=>setAForm(f=>({...f,time:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                  </div>
                  <div><label style={LS}>Location / Address</label><input value={aForm.location} onChange={e=>setAForm(f=>({...f,location:e.target.value}))} placeholder="e.g. 123 Main St, Suite 4" style={IS}/></div>
                  <div><label style={LS}>Reason for Visit</label><input value={aForm.reason} onChange={e=>setAForm(f=>({...f,reason:e.target.value}))} placeholder="e.g. Annual checkup, follow-up" style={IS}/></div>
                  <div><label style={LS}>Diagnosis</label><input value={aForm.diagnosis} onChange={e=>setAForm(f=>({...f,diagnosis:e.target.value}))} placeholder="e.g. Hypertension, Type 2 Diabetes" style={IS}/></div>
                  <div><label style={LS}>Notes from Visit</label><textarea value={aForm.notes} onChange={e=>setAForm(f=>({...f,notes:e.target.value}))} placeholder="Write anything the doctor told you, test results, instructions…" rows={4} style={{...IS,resize:"none",lineHeight:1.6}}/></div>
                  <div><label style={LS}>Follow-Up Date</label><input type="date" value={aForm.followUp} onChange={e=>setAForm(f=>({...f,followUp:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                  <div style={{display:"flex",gap:10,marginTop:4}}>
                    <button onClick={()=>setShowForm(false)} style={{flex:1,background:"transparent",border:"1px solid #2a2940",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                    <button onClick={saveA} className="btn" style={{flex:1,background:aForm.doctorName.trim()&&aForm.date?activeColor:"#2a2940",border:"none",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,fontFamily:"inherit"}}>{editId?"Save":"Add Appointment"}</button>
                  </div>
                </div>
              </>
            )}

            {/* ── MEDICATION FORM ── */}
            {tab==="medications"&&(
              <>
                <div style={{fontSize:18,fontWeight:400,marginBottom:18,color:activeColor}}>{editId?"Edit Medication":"New Medication"}</div>
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div><label style={LS}>Medication Name</label><input ref={titleRef} value={mForm.name} onChange={e=>setMForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Lisinopril, Metformin" style={IS}/></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={LS}>Dosage</label><input value={mForm.dosage} onChange={e=>setMForm(f=>({...f,dosage:e.target.value}))} placeholder="e.g. 10mg, 500mg" style={IS}/></div>
                    <div><label style={LS}>Frequency</label>
                      <select value={mForm.frequency} onChange={e=>setMForm(f=>({...f,frequency:e.target.value}))} style={IS}>
                        {FREQ_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <div><label style={LS}>Prescribing Doctor</label><input value={mForm.doctor} onChange={e=>setMForm(f=>({...f,doctor:e.target.value}))} placeholder="e.g. Dr. Johnson" style={IS}/></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><label style={LS}>Start Date</label><input type="date" value={mForm.startDate} onChange={e=>setMForm(f=>({...f,startDate:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                    <div><label style={LS}>End Date</label><input type="date" value={mForm.endDate} onChange={e=>setMForm(f=>({...f,endDate:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                  </div>
                  <div><label style={LS}>Refill Reminder Date</label><input type="date" value={mForm.refillDate} onChange={e=>setMForm(f=>({...f,refillDate:e.target.value}))} style={{...IS,colorScheme:"dark"}}/></div>
                  {mForm.refillDate&&(
                    <div>
                      <label style={LS}>🔔 Remind Before Refill</label>
                      <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {ADVANCE_OPTIONS.map(a=>{const on=(mForm.advance||[]).includes(a.value);return(
                          <button key={a.value} onClick={()=>setMForm(f=>({...f,advance:on?f.advance.filter(x=>x!==a.value):[...f.advance,a.value]}))} className="pill" style={{padding:"5px 11px",borderRadius:20,fontSize:12,border:`1px solid ${on?"#a78bfa":"#2a2940"}`,background:on?"rgba(167,139,250,0.15)":"transparent",color:on?"#a78bfa":"#5a5a7a",cursor:"pointer",fontFamily:"inherit"}}>{a.label}</button>
                        );})}
                      </div>
                    </div>
                  )}
                  <div><label style={LS}>Notes / Side Effects</label><textarea value={mForm.notes} onChange={e=>setMForm(f=>({...f,notes:e.target.value}))} placeholder="e.g. Take with food, may cause drowsiness, side effects observed…" rows={3} style={{...IS,resize:"none",lineHeight:1.6}}/></div>
                  <div style={{display:"flex",gap:10,marginTop:4}}>
                    <button onClick={()=>setShowForm(false)} style={{flex:1,background:"transparent",border:"1px solid #2a2940",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                    <button onClick={saveM} className="btn" style={{flex:1,background:mForm.name.trim()?activeColor:"#2a2940",border:"none",borderRadius:10,padding:"11px",color:"#fffffe",fontSize:14,fontFamily:"inherit"}}>{editId?"Save":"Add Medication"}</button>
                  </div>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

