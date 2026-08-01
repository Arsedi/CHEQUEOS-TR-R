import { useState, useEffect } from "react";

const STORAGE_KEY = "sectores_chequeo_data";
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MESES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ===== CATEGORÍAS (renglones de Valores) =====
const CATS = [
  { id:"trir",    nombre:"TRI-R",       unidad:"sector", etiqueta:"por sector",  color:"#3498db", codigos:"CRI · CRA · CRNU · CRF · LRC · CRQA · LRQA · CRAV · EBTFU" },
  { id:"ed",      nombre:"ED",          unidad:"sector", etiqueta:"por chequeo", color:"#9b59b6", codigos:"ED · CHK" },
  { id:"profrec", nombre:"PROF/REC",    unidad:"sesion", etiqueta:"por sesión",  color:"#f39c12", codigos:"PROF · REC" },
  { id:"rnpsim",  nombre:"RNP/RQA/SIM", unidad:"sesion", etiqueta:"por sesión",  color:"#1abc9c", codigos:"SIM · UPRT · RQA · RNP" },
  { id:"ftd",     nombre:"FTD/TIERRA",  unidad:"sesion", etiqueta:"por sesión",  color:"#e67e22", codigos:"FTD" },
  { id:"crm",     nombre:"CRM",         unidad:"sesion", etiqueta:"por sesión",  color:"#2ecc71", codigos:"CRM" },
];
const CAT_IDS = CATS.map(c=>c.id);
const catById = id => CATS.find(c=>c.id===id) || CATS[0];
const uWord = (catId,n) => { const u=catById(catId).unidad; return u==="sector" ? (n===1?"sector":"sectores") : (n===1?"sesión":"sesiones"); };

// Códigos del PDF
const TRIR_CODES = ["CRNU","CRQA","LRQA","CRF","LRC","CRAV","CRA","CRI","EBTFU"]; // CRAV antes de CRA
const PREFIJOS = { ed:["CHK"], profrec:["PROF","REC"], rnpsim:["SIM","UPRT","RQA","RNP"], ftd:["FTD"] };
const TODOS_CODIGOS = [...TRIR_CODES,"ED","CHK","PROF","REC","SIM","UPRT","RQA","RNP","FTD","CRM"];

const emptyCounts = () => ({trir:0,ed:0,profrec:0,rnpsim:0,ftd:0,crm:0});
const defaultValores = () => ({trir:0,ed:0,profrec:0,rnpsim:0,ftd:0,crm:0});
const totU = o => CAT_IDS.reduce((s,c)=>s+(o&&o[c]?o[c]:0),0);

// ===== MIGRACIÓN v1 -> v2 (datos viejos intactos en números) =====
function migrarRegistro(r, valorTrirGlobal){
  if (r && r.prog) {
    return {...r,
      prog:{...emptyCounts(),...r.prog},
      ejec:{...emptyCounts(),...r.ejec},
      valores:{...defaultValores(),...(r.valores||{})},
      log: Array.isArray(r.log)?r.log:[] };
  }
  const prog = emptyCounts(); prog.trir = r.sectoresProgramados||0;
  const ejec = emptyCounts(); ejec.trir = r.sectoresEjecutados||0;
  const valores = defaultValores(); valores.trir = r.valorSector||valorTrirGlobal||0;
  return { ano:r.ano, mes:r.mes, diasProgramados:r.diasProgramados||0, prog, ejec, valores,
    log:(r.log||[]).map(e=>({fecha:e.fecha, cat:"trir", cantidad:e.sectores||e.cantidad||0})) };
}
function migrarData(d){
  if (!d || typeof d !== "object") return { valores: defaultValores(), registros: [] };
  if (d.valores) {
    return { valores:{...defaultValores(),...d.valores}, registros:(d.registros||[]).map(r=>migrarRegistro(r, d.valores.trir)) };
  }
  const vs = d.valorSector||0;
  return { valores:{...defaultValores(), trir:vs}, registros:(d.registros||[]).map(r=>migrarRegistro(r, vs)) };
}
function loadData(){
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? migrarData(JSON.parse(r)) : { valores:defaultValores(), registros:[] }; }
  catch { return { valores:defaultValores(), registros:[] }; }
}
function saveData(d){ localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function fmt(n){ return new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(n||0); }

const yearNow = new Date().getFullYear();
const monthNow = new Date().getMonth();
const diasDelMes = (ano, mes) => new Date(ano, mes+1, 0).getDate();

// ===== CÁLCULO DE INGRESOS (regla de oro: siempre recalcular) =====
function valorCat(r, valoresGlobal, c){
  const v = r && r.valores ? r.valores[c] : 0;
  return v || (valoresGlobal ? valoresGlobal[c] : 0) || 0;
}
function ingresoRegistro(r, valoresGlobal){
  return CAT_IDS.reduce((s,c)=>{
    const p=r.prog[c]||0, e=r.ejec[c]||0;
    if(p===0 && e===0) return s;
    return s + Math.max(p,e)*valorCat(r,valoresGlobal,c);
  },0);
}
function ingresoSolo(r, valoresGlobal, campo){ // campo: "prog" | "ejec"
  return CAT_IDS.reduce((s,c)=>{
    const n=r[campo][c]||0;
    if(n===0) return s;
    return s + n*valorCat(r,valoresGlobal,c);
  },0);
}
function desglose(r, valoresGlobal){
  return CATS.map(c=>{
    const p=r.prog[c.id]||0, e=r.ejec[c.id]||0;
    if(p===0 && e===0) return null;
    const pago=Math.max(p,e);
    return { id:c.id, nombre:c.nombre, color:c.color, unidad:c.unidad, prog:p, ejec:e, pago, monto:pago*valorCat(r,valoresGlobal,c.id) };
  }).filter(Boolean);
}

// ===== PARSER DE PDF v2 =====
function contarVuelo(t, code){
  const re = new RegExp("\\b"+code+"\\s+(?:[a-zA-Z0-9]+\\s+)?\\d{3,4}","g");
  return (t.match(re)||[]).length;
}
function contarBare(t, code){
  const re = new RegExp("\\b"+code+"\\b","g");
  return (t.match(re)||[]).length;
}
function contarPrefijo(t, pref){
  const re = new RegExp("\\b"+pref+"[A-Z]*\\b","g");
  return (t.match(re)||[]).length;
}
function parsePdfText(fullText, fileName){
  const fechaMatch = fullText.match(/Fecha\s*Inicio\s*(\d{2})\/(\d{2})\/(\d{4})/);
  let mes=null, ano=null;
  if (fechaMatch){ mes=parseInt(fechaMatch[2])-1; ano=parseInt(fechaMatch[3]); }

  const detalle = {};
  const prog = emptyCounts();

  // TRI-R: códigos de vuelo (con número de vuelo)
  for (const code of TRIR_CODES){
    const n = contarVuelo(fullText, code);
    if(n>0){ detalle[code]=n; prog.trir+=n; }
  }
  // ED: tramos de vuelo ÷2 (ida y vuelta = 1)
  let edLegs = contarVuelo(fullText,"ED");
  // Fallback si el PDF no separa código y número
  if (prog.trir===0 && edLegs===0){
    for (const code of TRIR_CODES){
      const n = contarBare(fullText, code);
      if(n>0){ detalle[code]=n; prog.trir+=n; }
    }
    edLegs = contarBare(fullText,"ED");
  }
  if (edLegs>0){ detalle["ED"]=edLegs; prog.ed += Math.ceil(edLegs/2); }
  // CHK (prefijo, cuenta 1 c/u) va al renglón ED
  const chk = contarPrefijo(fullText,"CHK");
  if (chk>0){ detalle["CHK"]=chk; prog.ed += chk; }
  // Sesiones por prefijo
  for (const catId of ["profrec","rnpsim","ftd"]){
    for (const pref of PREFIJOS[catId]){
      if (pref==="CHK") continue;
      const n = contarPrefijo(fullText, pref);
      if(n>0){ detalle[pref]=(detalle[pref]||0)+n; prog[catId]+=n; }
    }
  }
  // CRM exacto
  const crm = contarBare(fullText,"CRM");
  if (crm>0){ detalle["CRM"]=crm; prog.crm+=crm; }

  // Días con chequeo (fecha seguida de un código en ~70 chars)
  const codeNearRe = new RegExp("\\b("+TODOS_CODIGOS.join("|")+")");
  const dateTokenRe = /\d{2}\/\d{2}\/\d{4}/g;
  const daysSet = new Set();
  let dm;
  while ((dm = dateTokenRe.exec(fullText)) !== null){
    if (daysSet.has(dm[0])) continue;
    const before = fullText.substring(Math.max(0, dm.index-15), dm.index);
    if (/Fecha/i.test(before)) continue;
    const chunk = fullText.substring(dm.index, dm.index+70);
    if (codeNearRe.test(chunk)) daysSet.add(dm[0]);
  }
  let diasConChequeo = daysSet.size;
  const totalU = totU(prog);
  if (diasConChequeo===0 && totalU>0) diasConChequeo = Math.round(totalU/4)||1;

  return { mes, ano, prog, diasProgramados:diasConChequeo, detalle, fileName };
}

export default function App(){
  const [data, setData] = useState(loadData);
  const [view, setView] = useState("resumen");
  const [planForm, setPlanForm] = useState({ ano:yearNow, mes:(monthNow+1>11?0:monthNow+1), dias:"", cat:"trir", cantidad:"" });
  const [volarForm, setVolarForm] = useState(()=>{
    const d = loadData();
    const hoyDia = new Date().getDate();
    const cur = d.registros.find(r=>r.ano===yearNow&&r.mes===monthNow);
    if (cur) return { ano:yearNow, mes:monthNow, dia:hoyDia, cat:"trir", cantidad:"" };
    if (d.registros.length>0){ const last=d.registros[d.registros.length-1]; return { ano:last.ano, mes:last.mes, dia:1, cat:"trir", cantidad:"" }; }
    return { ano:yearNow, mes:monthNow, dia:hoyDia, cat:"trir", cantidad:"" };
  });
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [valForm, setValForm] = useState(()=>{
    const d = loadData(); const o={};
    CAT_IDS.forEach(c=>{ o[c] = d.valores[c] ? String(d.valores[c]) : ""; });
    return o;
  });
  const [toast, setToast] = useState(null);
  const [grafAnio, setGrafAnio] = useState(()=>{
    const d=loadData(); const anios=[...new Set(d.registros.map(r=>r.ano))].sort();
    return anios.length>0 ? anios[anios.length-1] : yearNow;
  });
  const [grafSel, setGrafSel] = useState(null);
  const [pdfParsed, setPdfParsed] = useState(null);
  const [confirmarReemplazo, setConfirmarReemplazo] = useState(false);
  const [resTabAnio, setResTabAnio] = useState("Global");
  const [mpTab, setMpTab] = useState("Global");
  const [aniosExpanded, setAniosExpanded] = useState({[yearNow]:true});
  const [logsExpanded, setLogsExpanded] = useState({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [desdeAnio, setDesdeAnio] = useState(yearNow);
  const [desdeMes, setDesdeMes] = useState(monthNow);
  const [onboardingStep, setOnboardingStep] = useState(()=>{
    try { return localStorage.getItem("chequeos_onboarding_done") ? -1 : 0; } catch { return 0; }
  });
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(()=>{ saveData(data); },[data]);

  function showToast(msg,type="ok"){ setToast({msg,type}); setTimeout(()=>setToast(null),2800); }

  async function loadPdfJs(){
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload=resolve; s.onerror=reject;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return window.pdfjsLib;
  }

  async function handlePdfImport(file){
    if(!file) return;
    setPdfLoading(true); setPdfParsed(null);
    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data:arrayBuffer}).promise;
      let fullText="";
      for (let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i);
        const tc=await page.getTextContent();
        fullText += tc.items.map(it=>it.str).join(" ")+"\n";
      }
      window._pdfDebugText = fullText;
      const result = parsePdfText(fullText, file.name);
      setPdfParsed(result);
    } catch(e){
      console.error(e);
      showToast("Error leyendo el PDF","err");
    }
    setPdfLoading(false);
  }

  function handleConfirmarPdf(reemplazar=false){
    if(!pdfParsed) return;
    const { mes, ano, prog, diasProgramados } = pdfParsed;
    if (mes===null || ano===null){ showToast("No se detectó el mes del PDF","err"); return; }
    const registros=[...data.registros];
    const existe=registros.findIndex(r=>r.ano===ano&&r.mes===mes);
    if (existe>=0 && !reemplazar){ setConfirmarReemplazo(true); return; }
    const reg = {
      ano, mes, diasProgramados,
      prog:{...emptyCounts(),...prog},
      ejec: existe>=0 ? {...emptyCounts(),...registros[existe].ejec} : emptyCounts(),
      log:  existe>=0 ? (registros[existe].log||[]) : [],
      valores: existe>=0 ? {...defaultValores(),...registros[existe].valores} : {...data.valores}
    };
    if (existe>=0) registros[existe]=reg; else registros.push(reg);
    registros.sort((a,b)=>a.ano!==b.ano?a.ano-b.ano:a.mes-b.mes);
    setData(d=>({...d, registros}));
    setPdfParsed(null); setConfirmarReemplazo(false);
    showToast("Programación importada ✓"); setView("resumen");
  }

  function handlePlanearAgregar(){
    const ano=parseInt(planForm.ano), mes=parseInt(planForm.mes);
    const cant=parseInt(planForm.cantidad);
    if(!cant || cant<1){ showToast("Ingresa la cantidad","err"); return; }
    const registros=[...data.registros];
    let idx=registros.findIndex(r=>r.ano===ano&&r.mes===mes);
    if(idx<0){
      registros.push({ ano, mes, diasProgramados:0, prog:emptyCounts(), ejec:emptyCounts(), log:[], valores:{...data.valores} });
      registros.sort((a,b)=>a.ano!==b.ano?a.ano-b.ano:a.mes-b.mes);
      idx=registros.findIndex(r=>r.ano===ano&&r.mes===mes);
    }
    const reg={...registros[idx], prog:{...registros[idx].prog}};
    reg.prog[planForm.cat]=cant;
    if (planForm.dias!=="" && parseInt(planForm.dias)>0) reg.diasProgramados=parseInt(planForm.dias);
    registros[idx]=reg;
    setData(d=>({...d, registros}));
    setPlanForm(f=>({...f, cantidad:""}));
    showToast(`${catById(planForm.cat).nombre}: ${cant} programado${cant>1?"s":""} ✓`);
  }

  function handleQuitarProg(ano, mes, cat){
    const registros=[...data.registros];
    const idx=registros.findIndex(r=>r.ano===ano&&r.mes===mes);
    if(idx<0) return;
    const reg={...registros[idx], prog:{...registros[idx].prog}};
    reg.prog[cat]=0;
    registros[idx]=reg;
    setData(d=>({...d, registros}));
    showToast("Programación quitada");
  }

  function recomputarEjec(reg){
    const e=emptyCounts();
    (reg.log||[]).forEach(en=>{ if(e[en.cat]!==undefined) e[en.cat]+= (en.cantidad||0); });
    return e;
  }

  function handleVolar(){
    const {ano,mes,dia,cat,cantidad}=volarForm;
    const cant=parseInt(cantidad);
    if(!cant || cant<1){ showToast("Ingresa la cantidad","err"); return; }
    const registros=[...data.registros];
    const idx=registros.findIndex(r=>r.ano===parseInt(ano)&&r.mes===parseInt(mes));
    if(idx<0){ showToast("Primero programa ese mes","err"); return; }
    const dd=Math.min(Math.max(parseInt(dia)||1,1), diasDelMes(parseInt(ano),parseInt(mes)));
    const fecha=`${ano}-${String(parseInt(mes)+1).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
    const reg={...registros[idx]};
    reg.log=[...(reg.log||[]), {fecha, cat, cantidad:cant}];
    reg.log.sort((a,b)=> a.fecha<b.fecha ? -1 : (a.fecha>b.fecha ? 1 : 0));
    reg.ejec=recomputarEjec(reg);
    registros[idx]=reg;
    setData(d=>({...d, registros}));
    setVolarForm(f=>({...f, cantidad:""}));
    showToast(`+${cant} ${uWord(cat,cant)} de ${catById(cat).nombre} ✓`);
    setView("resumen");
  }

  function handleEliminarLog(regIdx, logIdx){
    const registros=[...data.registros];
    const reg={...registros[regIdx]};
    reg.log=(reg.log||[]).filter((_,i)=>i!==logIdx);
    reg.ejec=recomputarEjec(reg);
    registros[regIdx]=reg;
    setData(d=>({...d, registros}));
    showToast("Entrada eliminada");
  }

  function handleEditar(idx){
    const r=data.registros[idx];
    const p={}; CAT_IDS.forEach(c=>{ p[c]= r.prog[c] ? String(r.prog[c]) : ""; });
    setEditForm({ dias: r.diasProgramados?String(r.diasProgramados):"", prog:p });
    setEditIdx(idx); setView("editar");
  }

  function handleGuardarEdicion(){
    const registros=[...data.registros];
    const reg={...registros[editIdx], prog:{...registros[editIdx].prog}};
    CAT_IDS.forEach(c=>{ const v=parseInt(editForm.prog[c]); reg.prog[c]= (!isNaN(v)&&v>0)?v:0; });
    const dd=parseInt(editForm.dias); reg.diasProgramados=(!isNaN(dd)&&dd>0)?dd:0;
    if(!reg.valores) reg.valores={...data.valores};
    registros[editIdx]=reg;
    setData(d=>({...d, registros}));
    setEditIdx(null); setEditForm(null);
    showToast("Actualizado ✓"); setView("resumen");
  }

  function handleEliminarMes(idx){
    setData(d=>({...d, registros:d.registros.filter((_,i)=>i!==idx)}));
    showToast("Mes eliminado");
  }

  function handleGuardarValores(){
    const nuevos={};
    let alguno=false;
    for (const c of CAT_IDS){
      const raw=String(valForm[c]||"").replace(/\D/g,"");
      const v=raw===""?0:parseInt(raw);
      nuevos[c]=isNaN(v)?0:v;
      if(nuevos[c]>0) alguno=true;
    }
    if(!alguno){ showToast("Ingresa al menos un valor","err"); return; }
    const registros=data.registros.map(r=>{
      const despues = r.ano>desdeAnio || (r.ano===desdeAnio && r.mes>=desdeMes);
      if(despues) return {...r, valores:{...nuevos}};
      return r;
    });
    setData({ valores:nuevos, registros });
    showToast("Valores actualizados ✓");
    setView("resumen");
  }

  function handleResetTodo(){
    setData({ valores:defaultValores(), registros:[] });
    const o={}; CAT_IDS.forEach(c=>o[c]="");
    setValForm(o);
    setConfirmReset(false);
    localStorage.removeItem("chequeos_onboarding_done");
    setOnboardingStep(0);
    showToast("Datos borrados ✓");
    setView("resumen");
  }

  // ===== DERIVADOS =====
  const regs = data.registros;
  const calcIngreso = r => ingresoRegistro(r, data.valores);
  const totalEjecU = regs.reduce((s,r)=>s+totU(r.ejec),0);
  const totalProgU = regs.reduce((s,r)=>s+totU(r.prog),0);
  const totalIngresos = regs.reduce((s,r)=>s+calcIngreso(r),0);
  const anios = [...new Set(regs.map(r=>r.ano))].sort();

  const tendencia = (()=>{
    if (regs.length<2) return null;
    const sorted=[...regs].sort((a,b)=>a.ano!==b.ano?a.ano-b.ano:a.mes-b.mes);
    const last3=sorted.slice(-3), prev3=sorted.slice(-6,-3);
    if(prev3.length===0) return null;
    const avgLast=last3.reduce((s,r)=>s+calcIngreso(r),0)/last3.length;
    const avgPrev=prev3.reduce((s,r)=>s+calcIngreso(r),0)/prev3.length;
    const diff=avgLast-avgPrev;
    const pct=avgPrev>0?Math.round((diff/avgPrev)*100):0;
    return {diff,pct,up:diff>=0};
  })();

  const proyeccionAnual = (()=>{
    const rsAnio=regs.filter(r=>r.ano===yearNow);
    if(rsAnio.length===0) return null;
    const acumulado=rsAnio.reduce((s,r)=>s+calcIngreso(r),0);
    const promMensual=acumulado/rsAnio.length;
    const lastMes=Math.max(...rsAnio.map(r=>r.mes));
    const mesesRestantes=11-lastMes;
    return { proyeccion:acumulado+promMensual*mesesRestantes, promMensual, mesesRestantes };
  })();

  const mesActual = regs.find(r=>r.ano===yearNow&&r.mes===monthNow);
  const mesAnterior = regs.find(r=>r.ano===yearNow-1&&r.mes===monthNow);

  const inputStyle={width:"100%",background:"#1a2533",border:"1px solid #2d3f52",color:"#e8edf2",padding:"12px 14px",borderRadius:10,fontSize:15,boxSizing:"border-box"};
  const labelStyle={fontSize:12,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:6};
  const btnPrimary={width:"100%",background:"#c0392b",border:"none",color:"#fff",padding:"14px",borderRadius:12,fontSize:16,fontWeight:700,cursor:"pointer",marginBottom:12};
  const btnSecondary={width:"100%",background:"transparent",border:"1px solid #2d3f52",color:"#7a8fa6",padding:"12px",borderRadius:12,fontSize:15,cursor:"pointer"};

  return (
    <div style={{minHeight:"100vh",background:"#0f1923",color:"#e8edf2",fontFamily:"'Inter','Segoe UI',sans-serif",paddingBottom:90}}>

      {/* HEADER */}
      <div style={{position:"sticky",top:0,zIndex:10}}>
        <div style={{background:"linear-gradient(135deg,#1a0a0a 0%,#7a1510 45%,#c0392b 100%)",padding:"22px 20px 18px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",right:0,top:0,bottom:0,width:4,background:"rgba(255,255,255,0.08)"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:26,fontWeight:900,color:"#fff",letterSpacing:-0.5,lineHeight:1}}>avianca</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.55)",letterSpacing:4,textTransform:"uppercase",marginTop:4}}>TRI-R · Airbus A320</div>
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:1,marginTop:4}}>v2.0</div>
          </div>
          <div style={{width:40,height:2,background:"rgba(255,255,255,0.3)",borderRadius:1,marginBottom:10}}/>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",textShadow:"0 2px 8px rgba(0,0,0,0.4)"}}>Registro de Chequeos</div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",marginTop:4,letterSpacing:1}}>Desarrollado por Diego Serrano A</div>
        </div>
      </div>

      {/* ONBOARDING */}
      {onboardingStep>=0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,15,22,0.97)",zIndex:1000,display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"40px 24px 36px"}}>
          {(()=>{
            const steps=[
              { icon:"⚙️", title:"Bienvenido a Chequeos TRIR",
                desc:"Tu app para registrar y controlar tus chequeos como instructor TRI-R A320.",
                sub:"⚠️ Esta es una herramienta de uso y control personal. No está afiliada ni asociada a avianca ni a ninguna aerolínea. Los datos ingresados son de tu exclusiva responsabilidad." },
              { icon:"💰", title:"Valores",
                desc:"En la pestaña Valores pon el valor de los tipos de chequeo que uses: TRI-R, ED, PROF/REC, RNP/RQA/SIM, FTD/TIERRA y CRM.",
                sub:"Los que no uses, déjalos vacíos — no se tienen en cuenta. Cada quien configura los suyos." },
              { icon:"📋", title:"Programado y Ejecutado",
                desc:"Sube el PDF de MyCrew (detecta y reparte cada código a su tipo) o ingrésalo manualmente. Luego registra lo que vas ejecutando, escogiendo el tipo.",
                sub:"El vuelo ED cuenta por ida y vuelta: cada 2 tramos = 1. El PDF lo calcula solo." },
              { icon:"📊", title:"Resumen y pago",
                desc:"La garantía se aplica por cada tipo: siempre te pagan el mayor entre programado y ejecutado, y todo se suma en un total combinado.",
                sub:"Revisa el desglose, tus barras de progreso y compara mes a mes. ¡Listo para empezar!" }
            ];
            const s=steps[onboardingStep];
            return (
              <>
                <div style={{display:"flex",justifyContent:"center",gap:8}}>
                  {steps.map((_,i)=>(
                    <div key={i} style={{width:i===onboardingStep?24:8,height:8,borderRadius:4,background:i===onboardingStep?"#c0392b":"rgba(255,255,255,0.2)",transition:"width 0.3s"}}/>
                  ))}
                </div>
                <div style={{textAlign:"center",padding:"0 10px"}}>
                  <div style={{fontSize:64,marginBottom:24}}>{s.icon}</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#fff",marginBottom:16,lineHeight:1.3}}>{s.title}</div>
                  <div style={{fontSize:15,color:"#e8edf2",lineHeight:1.6,marginBottom:16}}>{s.desc}</div>
                  <div style={{fontSize:13,color:"#7a8fa6",lineHeight:1.6,background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 16px"}}>{s.sub}</div>
                </div>
                <div>
                  <button onClick={()=>{
                    if(onboardingStep<steps.length-1){ setOnboardingStep(onboardingStep+1); }
                    else { localStorage.setItem("chequeos_onboarding_done","1"); setOnboardingStep(-1); }
                  }} style={{width:"100%",background:"#c0392b",border:"none",color:"#fff",padding:"16px",borderRadius:14,fontSize:17,fontWeight:700,cursor:"pointer",marginBottom:12}}>
                    {onboardingStep<steps.length-1?"Siguiente →":"¡Empezar!"}
                  </button>
                  {onboardingStep>0 && (
                    <button onClick={()=>setOnboardingStep(onboardingStep-1)} style={{width:"100%",background:"transparent",border:"none",color:"#7a8fa6",padding:"10px",fontSize:14,cursor:"pointer"}}>← Anterior</button>
                  )}
                  {onboardingStep===0 && (
                    <button onClick={()=>{localStorage.setItem("chequeos_onboarding_done","1");setOnboardingStep(-1);}} style={{width:"100%",background:"transparent",border:"none",color:"#7a8fa6",padding:"10px",fontSize:14,cursor:"pointer"}}>Saltar tutorial</button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* TOAST */}
      {toast && <div style={{position:"fixed",top:86,left:"50%",transform:"translateX(-50%)",background:toast.type==="err"?"#c0392b":"#27ae60",color:"#fff",padding:"10px 22px",borderRadius:30,fontSize:14,fontWeight:600,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",whiteSpace:"nowrap"}}>{toast.msg}</div>}

      <div style={{maxWidth:520,margin:"0 auto",padding:"0 16px"}}>

        {/* ===== RESUMEN ===== */}
        {view==="resumen" && (
          <div>
            {/* Mes actual */}
            {mesActual && (()=>{
              const ejecU=totU(mesActual.ejec), progU=totU(mesActual.prog);
              const ingresoPago=calcIngreso(mesActual);
              const ingresoEjec=ingresoSolo(mesActual,data.valores,"ejec");
              const ingresoGarantia=ingresoSolo(mesActual,data.valores,"prog");
              const dsg=desglose(mesActual,data.valores);
              const regIdxMes=regs.findIndex(r=>r.ano===yearNow&&r.mes===monthNow);
              return (
                <div style={{background:"linear-gradient(135deg,#1e3a5f,#1a2533)",borderRadius:14,padding:"16px 18px",marginTop:18,border:"1px solid #2d5a8e"}}>
                  <div style={{fontSize:11,color:"#5b9bd5",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>📅 Mes en curso — {MESES[mesActual.mes]} {mesActual.ano}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontSize:11,color:"#7a8fa6"}}>Ejecutados / Programados</div>
                      <div style={{fontSize:22,fontWeight:700}}>
                        <span style={{color:ejecU>=progU?"#2ecc71":"#f39c12"}}>{ejecU}</span>
                        <span style={{color:"#7a8fa6",fontSize:15}}> / {progU}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#7a8fa6"}}>💰 Te pagan (combinado)</div>
                      <div style={{fontSize:18,fontWeight:700,color:"#2ecc71"}}>{fmt(ingresoPago)}</div>
                    </div>
                  </div>

                  {/* Desglose por tipo */}
                  {dsg.length>0 && (
                    <div style={{marginTop:12,background:"rgba(26,37,51,0.8)",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>De dónde viene</div>
                      {dsg.map(d=>(
                        <div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
                          <div style={{fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                            <span style={{width:8,height:8,borderRadius:"50%",background:d.color,display:"inline-block"}}/>{d.nombre}
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:13,fontWeight:700,color:d.color}}>{fmt(d.monto)}</div>
                            <div style={{fontSize:10,color:"#7a8fa6"}}>{d.ejec}/{d.prog} {d.unidad==="sector"?"sect.":"ses."}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{marginTop:10,background:"rgba(26,37,51,0.8)",borderRadius:10,padding:"10px 14px"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                      <div>
                        <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Garantía</div>
                        <div style={{fontSize:13,fontWeight:600,color:"#3498db"}}>{fmt(ingresoGarantia)}</div>
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Ejecutado</div>
                        <div style={{fontSize:13,fontWeight:600,color:ejecU>=progU?"#2ecc71":"#f39c12"}}>{fmt(ingresoEjec)}</div>
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>{ejecU>=progU?"Extra":"Diferencia"}</div>
                        <div style={{fontSize:13,fontWeight:600,color:ejecU>=progU?"#2ecc71":"#e74c3c"}}>{ejecU>=progU?"+":""}{ejecU-progU} cheq.</div>
                      </div>
                    </div>
                  </div>

                  <div style={{marginTop:10,background:"#0f1923",borderRadius:6,height:8,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Math.min(100,progU>0?(ejecU/progU)*100:0)}%`,background:ejecU>=progU?"#2ecc71":"#3498db",borderRadius:6,transition:"width 0.4s"}}/>
                  </div>

                  {mesAnterior && (()=>{
                    const ingActual=calcIngreso(mesActual);
                    const ingAnt=calcIngreso(mesAnterior);
                    const ds=totU(mesActual.ejec)-totU(mesAnterior.ejec);
                    const dc=ingActual-ingAnt;
                    return (
                      <div style={{marginTop:12,borderTop:"1px solid #2d3f52",paddingTop:12}}>
                        <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>vs {MESES[monthNow]} {yearNow-1}</div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          <div>
                            <div style={{fontSize:11,color:"#7a8fa6"}}>Año pasado</div>
                            <div style={{fontSize:13,fontWeight:600,color:"#7a8fa6"}}>{totU(mesAnterior.ejec)} cheq. · {fmt(ingAnt)}</div>
                          </div>
                          <div>
                            <div style={{fontSize:11,color:"#7a8fa6"}}>Diferencia</div>
                            <div style={{fontSize:13,fontWeight:700,color:dc>=0?"#2ecc71":"#e74c3c"}}>{ds>=0?"+":""}{ds} cheq. · {dc>=0?"+":""}{fmt(dc)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {mesActual.log && mesActual.log.length>0 && (
                    <div style={{marginTop:12}}>
                      <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Historial del mes</div>
                      {[...mesActual.log].reverse().map((entry,i)=>{
                        const realLogIdx=mesActual.log.length-1-i;
                        return (
                          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #1e2d3d"}}>
                            <div>
                              <div style={{fontSize:13}}><span style={{color:"#7a8fa6"}}>{entry.fecha}</span><span style={{marginLeft:10,color:"#2ecc71",fontWeight:600}}>+{entry.cantidad} {uWord(entry.cat,entry.cantidad)}</span></div>
                              <div style={{fontSize:11,color:catById(entry.cat).color,fontWeight:700,marginTop:2}}>{catById(entry.cat).nombre}</div>
                            </div>
                            <button onClick={()=>handleEliminarLog(regIdxMes,realLogIdx)} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:13}}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* BARRAS DE PROGRESO */}
            {regs.length>0 && (
              <>
                <div style={{background:"#1a2533",borderRadius:14,padding:"16px 18px",marginTop:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:700}}>📈 Progreso por mes</div>
                    <select value={grafAnio} onChange={e=>{setGrafAnio(parseInt(e.target.value));setGrafSel(null);}} style={{background:"#0f1923",border:"1px solid #2d3f52",color:"#e8edf2",padding:"4px 10px",borderRadius:8,fontSize:13}}>
                      {anios.map(a=><option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {(()=>{
                    const barras = MESES_CORTO.map((m,i)=>{
                      const r=regs.find(x=>x.ano===grafAnio&&x.mes===i);
                      if(!r) return null;
                      const p=totU(r.prog), e=totU(r.ejec);
                      if(p===0&&e===0) return null;
                      const curso = r.ano===yearNow && r.mes===monthNow;
                      const color = curso ? "#3498db" : (e>p ? "#2ecc71" : (e===p ? "#3498db" : "#f39c12"));
                      return {m,i,r,p,e,curso,color};
                    }).filter(Boolean);
                    if(barras.length===0) return <div style={{textAlign:"center",color:"#7a8fa6",padding:20,fontSize:13}}>Aún sin datos en {grafAnio}.</div>;
                    const SC = Math.max(...barras.map(b=>Math.max(b.p,b.e)),1);
                    const H = 150;
                    const sel = barras.find(b=>grafSel===`${grafAnio}-${b.i}`) || barras[barras.length-1];
                    return (
                      <>
                        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:8}}>
                          {barras.map(b=>(
                            <div key={b.i} onClick={()=>setGrafSel(`${grafAnio}-${b.i}`)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",cursor:"pointer"}}>
                              <div style={{position:"relative",height:H,width:"100%",maxWidth:40}}>
                                <div style={{position:"absolute",bottom:0,left:0,right:0,height:Math.max(4,Math.round(b.p/SC*H)),background:"rgba(52,152,219,0.28)",borderRadius:"5px 5px 0 0"}}/>
                                <div style={{position:"absolute",bottom:0,left:0,right:0,height:Math.max(b.e>0?4:0,Math.round(b.e/SC*H)),background:b.color,borderRadius:"5px 5px 0 0",zIndex:2}}/>
                              </div>
                              <div style={{fontSize:11,color:sel.i===b.i?"#e8edf2":"#7a8fa6",fontWeight:sel.i===b.i?700:400,marginTop:8}}>{b.m}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:"8px 12px",marginTop:14,paddingTop:12,borderTop:"1px solid #2d3f52"}}>
                          {[["rgba(52,152,219,0.28)","Meta (programado)"],["#3498db","En curso / justo"],["#2ecc71","Cerró con extra"],["#f39c12","Cerró en garantía"]].map(([c,t],i)=>(
                            <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:10.5,color:"#7a8fa6"}}>
                              <span style={{width:10,height:9,borderRadius:2,background:c,display:"inline-block"}}/>{t}
                            </div>
                          ))}
                        </div>
                        {sel && (()=>{
                          const e2=sel.curso?{c:"#3498db",t:"En curso — llenándose"}:(sel.e>sel.p?{c:"#2ecc71",t:"Cerró por encima (extra)"}:(sel.e===sel.p?{c:"#3498db",t:"Cerró justo"}:{c:"#f39c12",t:"Cerró por debajo (garantía)"}));
                          return (
                            <div style={{background:"#0f1923",border:"1px solid #2d3f52",borderRadius:12,padding:"12px 14px",marginTop:14}}>
                              <div style={{fontSize:11,color:"#5b9bd5",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>📅 {MESES[sel.i]} {grafAnio}{sel.curso?" · en curso":""}</div>
                              <div style={{fontSize:22,fontWeight:800,color:e2.c}}>{sel.e} <span style={{color:"#7a8fa6",fontSize:15,fontWeight:600}}>/ {sel.p} chequeos</span></div>
                              <span style={{display:"inline-block",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,marginTop:7,color:e2.c,background:e2.c+"22",border:`1px solid ${e2.c}55`}}>{e2.t}</span>
                              <div style={{fontSize:13,color:"#7a8fa6",marginTop:9}}>Te pagan: <b style={{color:"#2ecc71"}}>{fmt(calcIngreso(sel.r))}</b></div>
                              {sel.curso && sel.p>sel.e && <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>Faltan {sel.p-sel.e} para la meta.</div>}
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>

                {/* AÑO EN CURSO */}
                {(()=>{
                  const rsAnio=regs.filter(r=>r.ano===yearNow);
                  if(rsAnio.length===0) return null;
                  const ejecAnio=rsAnio.reduce((s,r)=>s+totU(r.ejec),0);
                  const progAnio=rsAnio.reduce((s,r)=>s+totU(r.prog),0);
                  const ingAnio=rsAnio.reduce((s,r)=>s+calcIngreso(r),0);
                  const eficAnio=progAnio>0?Math.round((ejecAnio/progAnio)*100):0;
                  return (
                    <div style={{background:"linear-gradient(135deg,#1e3a5f,#1a2533)",border:"1px solid #2d5a8e",borderRadius:14,padding:"14px 18px",marginTop:16}}>
                      <div style={{fontSize:11,color:"#5b9bd5",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>📅 {yearNow} — Año en curso</div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6"}}>Ingresos acumulados</div>
                          <div style={{fontSize:20,fontWeight:700,color:"#2ecc71"}}>{fmt(ingAnio)}</div>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6"}}>Promedio mensual</div>
                          <div style={{fontSize:18,fontWeight:700,color:"#f39c12"}}>{fmt(ingAnio/rsAnio.length)}</div>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Prog.</div><div style={{fontSize:15,fontWeight:700,color:"#3498db"}}>{progAnio}</div></div>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Ejec.</div><div style={{fontSize:15,fontWeight:700,color:ejecAnio>=progAnio?"#2ecc71":"#f39c12"}}>{ejecAnio}</div></div>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Eficiencia</div><div style={{fontSize:15,fontWeight:700,color:eficAnio>=90?"#2ecc71":eficAnio>=70?"#f39c12":"#e74c3c"}}>{eficAnio}%</div></div>
                      </div>
                      <div style={{marginTop:10,background:"#0f1923",borderRadius:6,height:6,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${Math.min(100,progAnio>0?(ejecAnio/progAnio)*100:0)}%`,background:"#3498db",borderRadius:6}}/>
                      </div>
                    </div>
                  );
                })()}

                {/* TOTALES HISTÓRICOS */}
                <div style={{fontSize:12,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginTop:20,marginBottom:10}}>Totales históricos</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  {[
                    {label:"Total Ingresos",value:fmt(totalIngresos),color:"#2ecc71"},
                    {label:"Chequeos Ejec.",value:`${totalEjecU} / ${totalProgU}`,color:"#3498db"},
                    {label:"Prom. Mensual",value:regs.length>0?fmt(totalIngresos/regs.length):"$ 0",color:"#f39c12"},
                    {label:"Eficiencia Global",value:`${totalProgU>0?Math.round((totalEjecU/totalProgU)*100):0}%`,color:totalEjecU>=totalProgU?"#2ecc71":"#e74c3c"},
                  ].map((k,i)=>(
                    <div key={i} style={{background:"#1a2533",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1}}>{k.label}</div>
                      <div style={{fontSize:18,fontWeight:700,color:k.color,marginTop:4}}>{k.value}</div>
                    </div>
                  ))}
                </div>

                {/* TENDENCIA */}
                {tendencia && (
                  <div style={{marginTop:12}}>
                    <div style={{background:"#1a2533",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1}}>📈 Tendencia</div>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
                        <div style={{fontSize:22,fontWeight:700,color:tendencia.up?"#2ecc71":"#e74c3c"}}>{tendencia.up?"▲":"▼"} {Math.abs(tendencia.pct)}%</div>
                        <div style={{fontSize:12,color:"#7a8fa6"}}>vs los 3 meses anteriores</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* PROYECCIÓN ANUAL */}
                {proyeccionAnual && (
                  <div style={{background:"linear-gradient(135deg,#1a1a2e,#1a2533)",border:"1px solid #2d3f52",borderRadius:14,padding:"14px 18px",marginTop:12}}>
                    <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>🎯 Proyección {yearNow}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div>
                        <div style={{fontSize:11,color:"#7a8fa6"}}>Al ritmo actual</div>
                        <div style={{fontSize:18,fontWeight:700,color:"#f39c12"}}>{fmt(proyeccionAnual.proyeccion)}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#7a8fa6"}}>Faltan {proyeccionAnual.mesesRestantes} mes{proyeccionAnual.mesesRestantes!==1?"es":""} del año</div>
                        <div style={{fontSize:15,fontWeight:600,color:"#3498db"}}>{fmt(proyeccionAnual.promMensual)}/mes</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* DESTACADOS */}
                {regs.length>0 && (()=>{
                  const mpTabs=["Global",...anios.map(a=>String(a))];
                  const mpRegs=mpTab==="Global"?regs:regs.filter(r=>r.ano===parseInt(mpTab));
                  const mejor=mpRegs.length?mpRegs.reduce((a,b)=>calcIngreso(a)>calcIngreso(b)?a:b):null;
                  const peor=mpRegs.length?mpRegs.reduce((a,b)=>calcIngreso(a)<calcIngreso(b)?a:b):null;
                  return (
                    <div style={{background:"#1a2533",borderRadius:14,padding:"14px 18px",marginTop:12}}>
                      <div style={{fontSize:11,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Destacados</div>
                      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto"}}>
                        {mpTabs.map(t=>(
                          <button key={t} onClick={()=>setMpTab(t)} style={{background:mpTab===t?"#c0392b":"rgba(255,255,255,0.06)",border:mpTab===t?"none":"1px solid #2d3f52",color:mpTab===t?"#fff":"#7a8fa6",padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:mpTab===t?700:400,cursor:"pointer",whiteSpace:"nowrap"}}>{t}</button>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase"}}>🏆 Mejor Mes</div>
                          {mejor ? <>
                            <div style={{fontSize:14,fontWeight:600,color:"#2ecc71",marginTop:4}}>{MESES[mejor.mes]} {mejor.ano}</div>
                            <div style={{fontSize:13,color:"#7a8fa6"}}>{fmt(calcIngreso(mejor))}</div>
                          </> : <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>Sin datos</div>}
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase"}}>📉 Peor Mes</div>
                          {peor ? <>
                            <div style={{fontSize:14,fontWeight:600,color:"#e74c3c",marginTop:4}}>{MESES[peor.mes]} {peor.ano}</div>
                            <div style={{fontSize:13,color:"#7a8fa6"}}>{fmt(calcIngreso(peor))}</div>
                          </> : <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>Sin datos</div>}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* RESUMEN POR PERÍODO */}
                {(()=>{
                  const tabs=["Global",...anios.map(a=>String(a))];
                  const isGlobal=resTabAnio==="Global";
                  const rs=isGlobal?regs:regs.filter(r=>r.ano===parseInt(resTabAnio));
                  const ejec=rs.reduce((s,r)=>s+totU(r.ejec),0);
                  const prog=rs.reduce((s,r)=>s+totU(r.prog),0);
                  const ing=rs.reduce((s,r)=>s+calcIngreso(r),0);
                  const efic=prog>0?Math.round((ejec/prog)*100):0;
                  const meses=rs.length;
                  return (
                    <div style={{background:"#1a2533",borderRadius:14,padding:"14px 18px",marginTop:12}}>
                      <div style={{fontSize:11,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Resumen por período</div>
                      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
                        {tabs.map(t=>(
                          <button key={t} onClick={()=>setResTabAnio(t)} style={{background:resTabAnio===t?"#c0392b":"rgba(255,255,255,0.06)",border:resTabAnio===t?"none":"1px solid #2d3f52",color:resTabAnio===t?"#fff":"#7a8fa6",padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:resTabAnio===t?700:400,cursor:"pointer",whiteSpace:"nowrap"}}>{t}</button>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Ingresos</div><div style={{fontSize:12,fontWeight:600,color:"#2ecc71"}}>{fmt(ing)}</div></div>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Prog.</div><div style={{fontSize:14,fontWeight:700,color:"#3498db"}}>{prog}</div></div>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Ejec.</div><div style={{fontSize:14,fontWeight:700,color:ejec>=prog?"#2ecc71":"#f39c12"}}>{ejec}</div></div>
                        <div><div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Efic.</div><div style={{fontSize:14,fontWeight:700,color:efic>=90?"#2ecc71":efic>=70?"#f39c12":"#e74c3c"}}>{efic}%</div></div>
                      </div>
                      <div style={{fontSize:11,color:"#7a8fa6"}}>{meses} mes{meses!==1?"es":""} · Prom: {meses>0?fmt(ing/meses):fmt(0)}</div>
                    </div>
                  );
                })()}
              </>
            )}

            {/* HISTORIAL POR MES */}
            <div style={{marginTop:20}}>
              <div style={{fontSize:12,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Historial por Mes</div>
              {regs.length===0 && (
                <div style={{background:"#1a2533",borderRadius:14,padding:30,textAlign:"center",color:"#7a8fa6"}}>
                  <div style={{fontSize:36,marginBottom:8}}>✈️</div>
                  <div>Aún no hay registros.<br/>Configura tus Valores y toca "Programado" para comenzar.</div>
                </div>
              )}
              {anios.slice().reverse().map(anio=>{
                const regsAnio=[...regs].filter(r=>r.ano===anio).reverse();
                const expanded=!!aniosExpanded[anio];
                const ingAnio=regsAnio.reduce((s,r)=>s+calcIngreso(r),0);
                return (
                  <div key={anio} style={{marginBottom:10}}>
                    <button onClick={()=>setAniosExpanded(prev=>({...prev,[anio]:!prev[anio]}))}
                      style={{width:"100%",background:"#1e2d3d",border:"1px solid #2d3f52",borderRadius:expanded?"14px 14px 0 0":"14px",padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:18,fontWeight:700,color:"#fff"}}>{anio}</span>
                        <span style={{fontSize:12,color:"#7a8fa6"}}>{regsAnio.length} mes{regsAnio.length!==1?"es":""}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:13,fontWeight:600,color:"#2ecc71"}}>{fmt(ingAnio)}</span>
                        <span style={{fontSize:14,color:"#7a8fa6",display:"inline-block",transform:expanded?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▼</span>
                      </div>
                    </button>
                    {expanded && (
                      <div style={{border:"1px solid #2d3f52",borderTop:"none",borderRadius:"0 0 14px 14px",overflow:"hidden"}}>
                        {regsAnio.map((r,i)=>{
                          const realIdx=regs.findIndex(x=>x.ano===r.ano&&x.mes===r.mes);
                          const eU=totU(r.ejec), pU=totU(r.prog);
                          const diff=eU-pU;
                          const dsg=desglose(r,data.valores);
                          const key=`${r.ano}-${r.mes}`;
                          return (
                            <div key={i} style={{background:"#1a2533",padding:"12px 16px",borderBottom:i<regsAnio.length-1?"1px solid #1e2d3d":"none"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:15,fontWeight:700}}>{MESES[r.mes]}</div>
                                  {r.diasProgramados>0 && <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>{r.diasProgramados} días programados</div>}
                                  <div style={{fontSize:12,color:"#7a8fa6",marginTop:2}}>
                                    {eU}/{pU} chequeos
                                    <span style={{marginLeft:6,color:diff>=0?"#2ecc71":"#e74c3c",fontWeight:600}}>({diff>=0?"+":""}{diff})</span>
                                  </div>
                                  {dsg.length>0 && (
                                    <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                                      {dsg.map(d=>(
                                        <span key={d.id} style={{fontSize:10,fontWeight:700,color:d.color,background:d.color+"22",border:`1px solid ${d.color}44`,borderRadius:6,padding:"1px 7px"}}>{d.nombre} {d.ejec}/{d.prog}</span>
                                      ))}
                                    </div>
                                  )}
                                  {dsg.length>0 && (
                                    <div style={{marginTop:6}}>
                                      {dsg.map(d=>(
                                        <div key={d.id} style={{fontSize:11,color:"#5b9bd5",marginTop:2}}>
                                          {d.nombre}: {fmt(valorCat(r,data.valores,d.id))}/{d.unidad==="sector"?"sector":"sesión"}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div style={{textAlign:"right"}}>
                                  <div style={{fontSize:16,fontWeight:700,color:"#2ecc71"}}>{fmt(calcIngreso(r))}</div>
                                  <div style={{fontSize:11,fontWeight:700,color:diff>=0?"#2ecc71":"#f39c12",background:diff>=0?"rgba(46,204,113,0.15)":"rgba(243,156,18,0.15)",border:`1px solid ${diff>=0?"rgba(46,204,113,0.3)":"rgba(243,156,18,0.3)"}`,borderRadius:6,padding:"2px 7px",marginTop:3,display:"inline-block"}}>{diff>=0?"▲ extra":"▼ garantía"}</div>
                                  <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                                    <button onClick={()=>handleEditar(realIdx)} style={{background:"rgba(52,152,219,0.15)",border:"none",color:"#3498db",padding:"4px 10px",borderRadius:6,fontSize:12,cursor:"pointer"}}>Editar</button>
                                    <button onClick={()=>handleEliminarMes(realIdx)} style={{background:"rgba(231,76,60,0.15)",border:"none",color:"#e74c3c",padding:"4px 10px",borderRadius:6,fontSize:12,cursor:"pointer"}}>Eliminar</button>
                                  </div>
                                  {r.log && r.log.length>0 && (
                                    <div style={{marginTop:8}}>
                                      <button onClick={()=>setLogsExpanded(prev=>({...prev,[key]:!prev[key]}))}
                                        style={{background:"rgba(52,152,219,0.08)",border:"1px solid rgba(52,152,219,0.25)",color:"#5b9bd5",padding:"5px 12px",borderRadius:8,fontSize:12,cursor:"pointer",width:"100%",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                        <span>📋 Entradas ({r.log.length})</span>
                                        <span style={{fontSize:11,transform:logsExpanded[key]?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s",display:"inline-block"}}>▼</span>
                                      </button>
                                      {logsExpanded[key] && (
                                        <div style={{borderTop:"1px solid #1e2d3d",marginTop:6,paddingTop:6}}>
                                          {[...r.log].reverse().map((entry,li)=>{
                                            const realLogIdx=r.log.length-1-li;
                                            return (
                                              <div key={li} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1a2533"}}>
                                                <div style={{textAlign:"left"}}>
                                                  <div style={{fontSize:12}}><span style={{color:"#7a8fa6"}}>{entry.fecha}</span><span style={{marginLeft:8,color:"#2ecc71",fontWeight:600}}>+{entry.cantidad} {uWord(entry.cat,entry.cantidad)}</span></div>
                                                  <div style={{fontSize:10,color:catById(entry.cat).color,fontWeight:700}}>{catById(entry.cat).nombre}</div>
                                                </div>
                                                <button onClick={()=>handleEliminarLog(realIdx,realLogIdx)} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:13}}>✕</button>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===== PROGRAMADO ===== */}
        {view==="planear" && (
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Programado</div>
            <div style={{fontSize:13,color:"#7a8fa6",marginBottom:20}}>Sube el PDF de MyCrew (reparte cada código a su tipo) o ingrésalo manualmente.</div>

            {!pdfParsed && (
              <div style={{marginBottom:20}}>
                <label style={{...labelStyle,marginBottom:10}}>📄 Importar desde PDF de MyCrew</label>
                <label style={{display:"block",background:"rgba(52,152,219,0.1)",border:"2px dashed rgba(52,152,219,0.4)",borderRadius:12,padding:"24px",textAlign:"center",cursor:"pointer"}}>
                  <input type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handlePdfImport(e.target.files[0])}/>
                  {pdfLoading
                    ? <div style={{color:"#3498db",fontSize:14}}>⏳ Leyendo PDF...</div>
                    : <div><div style={{fontSize:32,marginBottom:8}}>📂</div><div style={{color:"#3498db",fontSize:14,fontWeight:600}}>Toca para seleccionar el PDF</div><div style={{color:"#7a8fa6",fontSize:12,marginTop:4}}>Detecta TRI-R, ED, PROF/REC, RNP/RQA/SIM, FTD y CRM</div></div>
                  }
                </label>
              </div>
            )}

            {pdfParsed && (()=>{
              const dsgP=CATS.map(c=>({...c, n:pdfParsed.prog[c.id]||0})).filter(x=>x.n>0);
              const totalP=totU(pdfParsed.prog);
              const ingresoPot=CAT_IDS.reduce((s,c)=>s+(pdfParsed.prog[c]||0)*(data.valores[c]||0),0);
              return (
                <div style={{marginBottom:20}}>
                  <div style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:12,padding:"16px 18px",marginBottom:12}}>
                    <div style={{fontSize:12,color:"#2ecc71",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>✓ PDF leído correctamente</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                      <div><div style={{fontSize:11,color:"#7a8fa6"}}>Mes detectado</div><div style={{fontSize:16,fontWeight:700}}>{pdfParsed.mes!==null?MESES[pdfParsed.mes]+" "+pdfParsed.ano:"No detectado"}</div></div>
                      <div><div style={{fontSize:11,color:"#7a8fa6"}}>Días con chequeo</div><div style={{fontSize:16,fontWeight:700,color:"#3498db"}}>{pdfParsed.diasProgramados}</div></div>
                      <div><div style={{fontSize:11,color:"#7a8fa6"}}>Chequeos programados</div><div style={{fontSize:22,fontWeight:700,color:"#2ecc71"}}>{totalP}</div></div>
                      <div><div style={{fontSize:11,color:"#7a8fa6"}}>Ingreso potencial</div><div style={{fontSize:15,fontWeight:700,color:"#f39c12"}}>{fmt(ingresoPot)}</div></div>
                    </div>
                    {dsgP.length>0 && (
                      <div style={{borderTop:"1px solid rgba(46,204,113,0.2)",paddingTop:10,marginBottom:10}}>
                        <div style={{fontSize:11,color:"#7a8fa6",marginBottom:6}}>Por tipo</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {dsgP.map(d=>(
                            <div key={d.id} style={{background:d.color+"22",border:`1px solid ${d.color}55`,borderRadius:6,padding:"3px 10px",fontSize:13}}>
                              <span style={{color:d.color,fontWeight:700}}>{d.nombre}</span> <span>{d.n}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{borderTop:"1px solid rgba(46,204,113,0.2)",paddingTop:10}}>
                      <div style={{fontSize:11,color:"#7a8fa6",marginBottom:6}}>Desglose por código detectado</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {Object.entries(pdfParsed.detalle).map(([code,cnt])=>(
                          <div key={code} style={{background:"rgba(52,152,219,0.15)",border:"1px solid rgba(52,152,219,0.3)",borderRadius:6,padding:"3px 10px",fontSize:13}}>
                            <span style={{color:"#3498db",fontWeight:700}}>{code}</span> <span>{cnt}</span>
                          </div>
                        ))}
                      </div>
                      {pdfParsed.detalle["ED"]>0 && <div style={{fontSize:11,color:"#9b59b6",marginTop:8}}>✈️ ED: {pdfParsed.detalle["ED"]} tramo{pdfParsed.detalle["ED"]>1?"s":""} = {Math.ceil(pdfParsed.detalle["ED"]/2)} de pago (ida y vuelta = 1)</div>}
                    </div>
                  </div>
                  {confirmarReemplazo ? (
                    <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:12,padding:"16px",marginBottom:12}}>
                      <div style={{fontSize:14,color:"#e74c3c",fontWeight:600,marginBottom:4}}>⚠️ Este mes ya existe</div>
                      <div style={{fontSize:13,color:"#7a8fa6",marginBottom:14}}>{MESES[pdfParsed.mes]} {pdfParsed.ano} ya tiene datos. Lo ejecutado se conservará pero la programación se actualizará.</div>
                      <div style={{display:"flex",gap:10}}>
                        <button onClick={()=>setConfirmarReemplazo(false)} style={{flex:1,background:"#1a2533",border:"1px solid #2d3f52",color:"#7a8fa6",padding:"10px",borderRadius:10,fontSize:14,cursor:"pointer"}}>Cancelar</button>
                        <button onClick={()=>handleConfirmarPdf(true)} style={{flex:1,background:"#e74c3c",border:"none",color:"#fff",padding:"10px",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>Sí, reemplazar</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={()=>handleConfirmarPdf(false)} style={btnPrimary}>Confirmar e importar</button>
                  )}
                  <button onClick={()=>{setPdfParsed(null);setConfirmarReemplazo(false);}} style={{...btnSecondary,marginBottom:12}}>Volver a subir otro PDF</button>
                </div>
              );
            })()}

            {!pdfParsed && (
              <>
                <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0 20px",color:"#7a8fa6",fontSize:13}}>
                  <div style={{flex:1,height:1,background:"#2d3f52"}}/> o ingresa manualmente <div style={{flex:1,height:1,background:"#2d3f52"}}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                  <div><label style={labelStyle}>Año</label><input type="number" value={planForm.ano} onChange={e=>setPlanForm(f=>({...f,ano:e.target.value}))} style={inputStyle}/></div>
                  <div><label style={labelStyle}>Mes</label><select value={planForm.mes} onChange={e=>setPlanForm(f=>({...f,mes:parseInt(e.target.value)}))} style={inputStyle}>{MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}</select></div>
                </div>
                <div style={{marginBottom:16}}><label style={labelStyle}>Días de chequeo (opcional)</label><input type="number" value={planForm.dias} placeholder="ej: 8" onChange={e=>setPlanForm(f=>({...f,dias:e.target.value}))} style={inputStyle}/></div>
                <div style={{marginBottom:16}}><label style={labelStyle}>Qué tipo</label>
                  <select value={planForm.cat} onChange={e=>setPlanForm(f=>({...f,cat:e.target.value}))} style={inputStyle}>
                    {CATS.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={labelStyle}>¿Cuántos {uWord(planForm.cat,2)} programados?</label>
                  <input type="number" value={planForm.cantidad} placeholder="ej: 16" min="1" onChange={e=>setPlanForm(f=>({...f,cantidad:e.target.value}))} style={{...inputStyle,fontSize:28,fontWeight:700,textAlign:"center",color:"#3498db"}}/>
                  {planForm.cat==="ed" && <div style={{fontSize:11,color:"#9b59b6",marginTop:6}}>✈️ ED: ingresa los de pago (cada ida y vuelta = 1). El PDF lo calcula solo.</div>}
                </div>
                {planForm.cantidad && (data.valores[planForm.cat]||0)>0 && (
                  <div style={{background:"rgba(52,152,219,0.1)",border:"1px solid rgba(52,152,219,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16}}>
                    <div style={{fontSize:12,color:"#7a8fa6"}}>Ingreso potencial de este tipo</div>
                    <div style={{fontSize:20,fontWeight:700,color:"#3498db"}}>{fmt(parseInt(planForm.cantidad||0)*(data.valores[planForm.cat]||0))}</div>
                  </div>
                )}
                <button onClick={handlePlanearAgregar} style={btnPrimary}>Agregar al mes</button>

                {(()=>{
                  const r=regs.find(x=>x.ano===parseInt(planForm.ano)&&x.mes===parseInt(planForm.mes));
                  if(!r) return null;
                  const filas=CATS.map(c=>({...c,n:r.prog[c.id]||0})).filter(x=>x.n>0);
                  if(filas.length===0) return null;
                  return (
                    <div style={{marginTop:8,marginBottom:16}}>
                      <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Programado de {MESES[parseInt(planForm.mes)]} {planForm.ano}</div>
                      {filas.map(fRow=>(
                        <div key={fRow.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#1a2533",border:"1px solid #2d3f52",borderRadius:10,padding:"9px 12px",marginBottom:7}}>
                          <div style={{fontSize:13}}><span style={{color:fRow.color,fontWeight:700}}>{fRow.nombre}</span><span style={{marginLeft:8,color:"#2ecc71",fontWeight:600}}>{fRow.n} {uWord(fRow.id,fRow.n)}</span></div>
                          <button onClick={()=>handleQuitarProg(parseInt(planForm.ano),parseInt(planForm.mes),fRow.id)} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:14}}>✕</button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <button onClick={()=>setView("resumen")} style={btnSecondary}>Cancelar</button>
              </>
            )}
          </div>
        )}

        {/* ===== EJECUTADO ===== */}
        {view==="volar" && (
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Ejecutado</div>
            <div style={{fontSize:13,color:"#7a8fa6",marginBottom:20}}>Registra lo que hiciste. Escoge el tipo para sumarlo al renglón correcto.</div>
            {regs.length===0 ? (
              <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:12,padding:16,marginBottom:16,fontSize:13,color:"#e74c3c"}}>
                Primero sube tu programación en "Programado".
              </div>
            ) : (
              <div style={{marginBottom:16}}><label style={labelStyle}>Mes</label>
                <select
                  value={regs.find(r=>r.ano===volarForm.ano&&r.mes===volarForm.mes) ? `${volarForm.ano}-${volarForm.mes}` : `${regs[regs.length-1].ano}-${regs[regs.length-1].mes}`}
                  onChange={e=>{const [a,m]=e.target.value.split("-");const an=parseInt(a),me=parseInt(m);setVolarForm(f=>({...f,ano:an,mes:me,dia:Math.min(f.dia||1,diasDelMes(an,me))}));}}
                  style={inputStyle}>
                  {[...regs].reverse().map(r=><option key={`${r.ano}-${r.mes}`} value={`${r.ano}-${r.mes}`}>{MESES[r.mes]} {r.ano}</option>)}
                </select>
              </div>
            )}
            <div style={{marginBottom:16}}><label style={labelStyle}>Fecha</label>
              <select value={volarForm.dia} onChange={e=>setVolarForm(f=>({...f,dia:parseInt(e.target.value)}))} style={inputStyle}>
                {Array.from({length:diasDelMes(volarForm.ano,volarForm.mes)},(_,i)=>i+1).map(d=>(
                  <option key={d} value={d}>{String(d).padStart(2,"0")} de {MESES[volarForm.mes]} {volarForm.ano}</option>
                ))}
              </select>
            </div>
            <div style={{marginBottom:16}}><label style={labelStyle}>Qué registras</label>
              <select value={volarForm.cat} onChange={e=>setVolarForm(f=>({...f,cat:e.target.value}))} style={inputStyle}>
                {CATS.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div style={{marginBottom:16}}>
              <label style={labelStyle}>¿Cuántos {uWord(volarForm.cat,2)}?</label>
              <input type="number" value={volarForm.cantidad} placeholder="ej: 2" min="1" onChange={e=>setVolarForm(f=>({...f,cantidad:e.target.value}))} style={{...inputStyle,fontSize:32,fontWeight:700,textAlign:"center",color:"#2ecc71"}}/>
              {volarForm.cat==="ed" && <div style={{fontSize:11,color:"#9b59b6",marginTop:6}}>✈️ ED: registra los de pago (cada ida y vuelta = 1).</div>}
            </div>
            {(()=>{
              const r=regs.find(x=>x.mes===volarForm.mes&&x.ano===volarForm.ano);
              if(!r) return null;
              const cant=parseInt(volarForm.cantidad||0);
              const nuevoCat=(r.ejec[volarForm.cat]||0)+cant;
              const rSim={...r, ejec:{...r.ejec,[volarForm.cat]:nuevoCat}};
              return (
                <div style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:20}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>{catById(volarForm.cat).nombre} acumulado</div><div style={{fontSize:20,fontWeight:700,color:"#2ecc71"}}>{nuevoCat} / {r.prog[volarForm.cat]||0}</div></div>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>💰 Ingreso del mes</div><div style={{fontSize:18,fontWeight:700,color:"#2ecc71"}}>{fmt(ingresoRegistro(rSim,data.valores))}</div></div>
                  </div>
                </div>
              );
            })()}
            <button onClick={handleVolar} style={btnPrimary}>Registrar</button>
            <button onClick={()=>setView("resumen")} style={btnSecondary}>Cancelar</button>
          </div>
        )}

        {/* ===== EDITAR ===== */}
        {view==="editar" && editForm && (
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Editar programación</div>
            <div style={{fontSize:13,color:"#7a8fa6",marginBottom:20}}>Ajusta lo programado de cada tipo. Deja vacío lo que no aplique.</div>
            <div style={{marginBottom:16}}><label style={labelStyle}>Días programados</label><input type="number" value={editForm.dias} onChange={e=>setEditForm(f=>({...f,dias:e.target.value}))} style={inputStyle}/></div>
            {CATS.map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{flex:1,fontSize:14,fontWeight:700,color:c.color}}>{c.nombre}</div>
                <input type="number" value={editForm.prog[c.id]} placeholder="0" onChange={e=>setEditForm(f=>({...f,prog:{...f.prog,[c.id]:e.target.value}}))} style={{...inputStyle,width:120,textAlign:"right"}}/>
              </div>
            ))}
            <div style={{height:10}}/>
            <button onClick={handleGuardarEdicion} style={btnPrimary}>Guardar</button>
            <button onClick={()=>{setView("resumen");setEditIdx(null);setEditForm(null);}} style={btnSecondary}>Cancelar</button>
          </div>
        )}

        {/* ===== VALORES ===== */}
        {view==="valores" && (
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Valores</div>
            <div style={{fontSize:13,color:"#7a8fa6",marginBottom:18}}>Pon el valor de los tipos que uses. Los que no uses, déjalos vacíos — no se tienen en cuenta.</div>

            {CATS.map(c=>(
              <div key={c.id} style={{background:"#1a2533",border:"1px solid #2d3f52",borderRadius:14,padding:"12px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:700,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    {c.nombre}
                    <span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,padding:"2px 8px",borderRadius:20,color:c.unidad==="sector"?"#3498db":"#f39c12",background:c.unidad==="sector"?"rgba(52,152,219,0.15)":"rgba(243,156,18,0.15)",border:c.unidad==="sector"?"1px solid rgba(52,152,219,0.35)":"1px solid rgba(243,156,18,0.35)"}}>{c.etiqueta}</span>
                  </div>
                  <div style={{fontSize:10.5,color:"#7a8fa6",marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.codigos}</div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:2,background:"#0f1923",border:"1px solid #2d3f52",borderRadius:10,padding:"8px 10px",width:130,flexShrink:0}}>
                  <span style={{color:"#7a8fa6",fontSize:14}}>$</span>
                  <input type="number" value={valForm[c.id]} placeholder="0" onChange={e=>setValForm(f=>({...f,[c.id]:e.target.value}))} style={{width:"100%",background:"transparent",border:"none",color:"#2ecc71",fontSize:15,fontWeight:700,textAlign:"right",fontFamily:"inherit",outline:"none",minWidth:0}}/>
                </div>
              </div>
            ))}

            <label style={{...labelStyle,marginTop:16,marginBottom:6}}>Aplicar desde</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              <select value={desdeMes} onChange={e=>setDesdeMes(parseInt(e.target.value))} style={inputStyle}>
                {MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}
              </select>
              <select value={desdeAnio} onChange={e=>setDesdeAnio(parseInt(e.target.value))} style={inputStyle}>
                {[yearNow-1,yearNow,yearNow+1].map(a=><option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div style={{background:"rgba(243,156,18,0.1)",border:"1px solid rgba(243,156,18,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#f39c12"}}>
              ✓ Los valores aplicarán desde <strong>{MESES[desdeMes]} {desdeAnio}</strong> en adelante. Los meses anteriores conservan sus valores originales.
            </div>
            <button onClick={handleGuardarValores} style={btnPrimary}>Guardar valores</button>

            <div style={{borderTop:"1px solid #2d3f52",paddingTop:20,marginTop:20}}>
              <div style={{fontSize:13,color:"#7a8fa6",marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>Zona de peligro</div>
              {!confirmReset ? (
                <button onClick={()=>setConfirmReset(true)} style={{width:"100%",background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",color:"#e74c3c",padding:"12px",borderRadius:12,fontSize:15,fontWeight:600,cursor:"pointer"}}>🗑️ Borrar todos los datos</button>
              ) : (
                <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:12,padding:"16px"}}>
                  <div style={{fontSize:14,color:"#e74c3c",fontWeight:600,marginBottom:4}}>⚠️ ¿Estás seguro?</div>
                  <div style={{fontSize:13,color:"#7a8fa6",marginBottom:14}}>Se eliminarán todos los meses y valores registrados. No se puede deshacer.</div>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={()=>setConfirmReset(false)} style={{flex:1,background:"#1a2533",border:"1px solid #2d3f52",color:"#7a8fa6",padding:"10px",borderRadius:10,fontSize:14,cursor:"pointer"}}>Cancelar</button>
                    <button onClick={handleResetTodo} style={{flex:1,background:"#e74c3c",border:"none",color:"#fff",padding:"10px",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer"}}>Sí, borrar</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* DISCLAIMER */}
      <div style={{textAlign:"center",padding:"8px 20px 4px",fontSize:10,color:"rgba(255,255,255,0.2)",lineHeight:1.4}}>
        Herramienta de uso y control personal · No afiliada a avianca ni ninguna aerolínea
      </div>

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#111d2b",borderTop:"1px solid #1e2d3d",display:"flex",justifyContent:"space-around",padding:"10px 0 16px"}}>
        {[{id:"resumen",label:"Resumen",icon:"📊"},{id:"planear",label:"Programado",icon:"📋"},{id:"volar",label:"Ejecutado",icon:"✈️"},{id:"valores",label:"Valores",icon:"💰"}].map(tab=>(
          <button key={tab.id} onClick={()=>{
            if(tab.id==="volar" && regs.length>0){
              const currentExists=regs.find(r=>r.ano===yearNow&&r.mes===monthNow);
              if(currentExists){ setVolarForm(f=>({...f,ano:yearNow,mes:monthNow,dia:new Date().getDate()})); }
              else { const last=regs[regs.length-1]; setVolarForm(f=>({...f,ano:last.ano,mes:last.mes,dia:Math.min(f.dia||1,diasDelMes(last.ano,last.mes))})); }
            }
            if(tab.id==="valores"){
              const o={}; CAT_IDS.forEach(c=>{ o[c]=data.valores[c]?String(data.valores[c]):""; });
              setValForm(o);
            }
            setView(tab.id); setEditIdx(null); setEditForm(null); setPdfParsed(null); setConfirmarReemplazo(false);
          }} style={{background:"none",border:"none",color:view===tab.id?"#e74c3c":"#7a8fa6",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontSize:11,fontWeight:view===tab.id?700:400}}>
            <span style={{fontSize:22}}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
