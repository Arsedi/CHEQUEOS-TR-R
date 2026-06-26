import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const STORAGE_KEY = "sectores_chequeo_data";
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const MESES_CORTO = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const CODIGOS_CHEQUEO = ["CRNU","CRQA","LRQA","CRF","LRC","CRA","CRI","ED"];

const defaultData = () => ({ valorSector: 0, registros: [] });

function loadData() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : defaultData(); }
  catch { return defaultData(); }
}
function saveData(d) { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function fmt(n) { return new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(n); }

const yearNow = new Date().getFullYear();
const monthNow = new Date().getMonth();

function parsePdfText(fullText, fileName) {
  // Extract month/year from "Fecha Inicio DD/MM/YYYY"
  const fechaMatch = fullText.match(/Fecha\s*Inicio\s*(\d{2})\/(\d{2})\/(\d{4})/);
  let mes = null, ano = null;
  if (fechaMatch) { mes = parseInt(fechaMatch[2]) - 1; ano = parseInt(fechaMatch[3]); }

  const detalle = {};
  let totalSectores = 0;

  // Count sectors: find all "CODE XXXX" patterns (e.g. "CRI 8438")
  for (const code of CODIGOS_CHEQUEO) {
    // Match code followed by optional text (like "vri1") then a flight number
    const re = new RegExp(code + "\\s+(?:[a-zA-Z0-9]+\\s+)?\\d{3,4}", "g");
    const matches = fullText.match(re) || [];
    if (matches.length > 0) {
      detalle[code] = matches.length;
      totalSectores += matches.length;
    }
  }

  // Count unique days with chequeo codes.
  // pdf.js reads rows left-to-right so date and first code appear close together.
  // Skip header dates (Fecha Inicio / Fecha Fin) by excluding dates within 30 chars of "Fecha"
  const codeNearRe = new RegExp("(" + CODIGOS_CHEQUEO.join("|") + ")\\s+(?:[a-zA-Z0-9]+\\s+)?\\d{3,4}");
  const dateTokenRe = /\d{2}\/\d{2}\/\d{4}/g;
  const daysSet = new Set();
  let dm3;
  while ((dm3 = dateTokenRe.exec(fullText)) !== null) {
    if (daysSet.has(dm3[0])) continue;
    // Skip header dates: check 30 chars before for "Fecha"
    const before = fullText.substring(Math.max(0, dm3.index - 30), dm3.index);
    if (/Fecha/i.test(before)) continue;
    // Check 70 chars after date for a chequeo code
    const chunk = fullText.substring(dm3.index, dm3.index + 70);
    if (codeNearRe.test(chunk)) daysSet.add(dm3[0]);
  }
  let diasConChequeo = daysSet.size;
  if (diasConChequeo === 0 && totalSectores > 0) diasConChequeo = Math.round(totalSectores / 4);

  // Fallback if 0 sectors (pdf.js may not add spaces between code and number)
  if (totalSectores === 0) {
    for (const code of CODIGOS_CHEQUEO) {
      const re = new RegExp("\\b" + code + "\\b", "g");
      const matches = fullText.match(re) || [];
      if (matches.length > 0) { detalle[code] = matches.length; totalSectores += matches.length; }
    }
    diasConChequeo = Math.ceil(totalSectores / 4);
  }

  return { mes, ano, sectoresProgramados: totalSectores, diasProgramados: diasConChequeo, detalle, fileName };
}




export default function App() {
  const [data, setData] = useState(loadData);
  const [view, setView] = useState("resumen");
  const [planForm, setPlanForm] = useState({ ano: yearNow, mes: monthNow+1>11?0:monthNow+1, diasProgramados:"", sectoresProgramados:"" });
  const [volarForm, setVolarForm] = useState(() => {
    const d = loadData();
    if (d.registros.length > 0) {
      const last = d.registros[d.registros.length - 1];
      return { ano: last.ano, mes: last.mes, sectoresHoy: "" };
    }
    return { ano: yearNow, mes: monthNow, sectoresHoy: "" };
  });
  const [editIdx, setEditIdx] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [nuevoValor, setNuevoValor] = useState("");
  const [toast, setToast] = useState(null);
  const [notifPerm, setNotifPerm] = useState(typeof Notification!=="undefined"?Notification.permission:"denied");
  const [grafAnio, setGrafAnio] = useState(() => {
    const d = loadData();
    const anios = [...new Set(d.registros.map(r => r.ano))].sort();
    return anios.length > 0 ? anios[anios.length - 1] : yearNow;
  });
  const [pdfParsed, setPdfParsed] = useState(null);
  const [reporteData, setReporteData] = useState(null);
  const [resTabAnio, setResTabAnio] = useState("Global");
  const [mpTab, setMpTab] = useState("Global");
  const [aniosExpanded, setAniosExpanded] = useState({[yearNow]: true});
  const [confirmReset, setConfirmReset] = useState(false);
  const [desdeAnio, setDesdeAnio] = useState(yearNow);
  const [desdeMes, setDesdeMes] = useState(monthNow);
  const [onboardingStep, setOnboardingStep] = useState(() => {
    try { return localStorage.getItem("chequeos_onboarding_done") ? -1 : 0; }
    catch { return 0; }
  });
  const [pdfLoading, setPdfLoading] = useState(false);
  const resumenRef = useRef(null);

  useEffect(() => { saveData(data); }, [data]);

  function showToast(msg, type="ok") { setToast({msg,type}); setTimeout(()=>setToast(null),2800); }

  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return window.pdfjsLib;
  }

  async function handlePdfImport(file) {
    if (!file) return;
    setPdfLoading(true); setPdfParsed(null);
    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        fullText += tc.items.map(it => it.str).join(" ") + "\n";
      }
      // DEBUG: store raw text to inspect
      window._pdfDebugText = fullText;
      console.log("PDF TEXT SAMPLE:", fullText.substring(0, 2000));
      console.log("CRI occurrences:", (fullText.match(/CRI/g)||[]).length);
      console.log("CRA occurrences:", (fullText.match(/CRA/g)||[]).length);
      const result = parsePdfText(fullText, file.name);
      console.log("PARSE RESULT:", JSON.stringify(result));
      setPdfParsed(result);
    } catch(e) {
      console.error(e);
      showToast("Error leyendo el PDF", "err");
    }
    setPdfLoading(false);
  }

  function handleConfirmarPdf() {
    if (!pdfParsed) return;
    const { mes, ano, sectoresProgramados, diasProgramados } = pdfParsed;
    const registros = [...data.registros];
    const existe = registros.findIndex(r => r.ano === ano && r.mes === mes);
    const reg = { ano, mes, diasProgramados, sectoresProgramados,
      valorSector: data.valorSector,
      sectoresEjecutados: existe>=0 ? registros[existe].sectoresEjecutados : 0,
      log: existe>=0 ? registros[existe].log||[] : [],
      ingresoActual: 0 };
    reg.ingresoActual = reg.sectoresEjecutados * reg.valorSector;
    if (existe>=0) registros[existe] = reg; else registros.push(reg);
    registros.sort((a,b) => a.ano!==b.ano ? a.ano-b.ano : a.mes-b.mes);
    setData(d => ({...d, registros}));
    setPdfParsed(null);
    showToast("Programación importada ✓");
    setView("resumen");
  }

  function handlePlanear() {
    const {ano,mes,diasProgramados,sectoresProgramados} = planForm;
    if (!diasProgramados||!sectoresProgramados){showToast("Completa todos los campos","err");return;}
    const registros=[...data.registros];
    const existe=registros.findIndex(r=>r.ano===parseInt(ano)&&r.mes===parseInt(mes));
    const reg={ano:parseInt(ano),mes:parseInt(mes),diasProgramados:parseInt(diasProgramados),sectoresProgramados:parseInt(sectoresProgramados),
      valorSector: data.valorSector,
      sectoresEjecutados:existe>=0?registros[existe].sectoresEjecutados:0,
      log:existe>=0?registros[existe].log||[]:[],ingresoActual:0};
    reg.ingresoActual=reg.sectoresEjecutados*reg.valorSector;
    if(existe>=0)registros[existe]=reg; else registros.push(reg);
    registros.sort((a,b)=>a.ano!==b.ano?a.ano-b.ano:a.mes-b.mes);
    setData(d=>({...d,registros}));
    setPlanForm({ano:yearNow,mes:monthNow+1>11?0:monthNow+1,diasProgramados:"",sectoresProgramados:""});
    showToast("Programación guardada ✓"); setView("resumen");
  }

  function handleVolar() {
    const {ano,mes,sectoresHoy}=volarForm;
    if(!sectoresHoy||parseInt(sectoresHoy)<1){showToast("Ingresa al menos 1 sector","err");return;}
    const registros=[...data.registros];
    const idx=registros.findIndex(r=>r.ano===parseInt(ano)&&r.mes===parseInt(mes));
    if(idx<0){showToast("Primero planea ese mes","err");return;}
    const hoy=new Date().toISOString().slice(0,10);
    const cuantos=parseInt(sectoresHoy);
    const reg={...registros[idx]};
    reg.log=[...(reg.log||[]),{fecha:hoy,sectores:cuantos}];
    reg.sectoresEjecutados=reg.log.reduce((s,e)=>s+e.sectores,0);
    const sectoresPago1=Math.max(reg.sectoresEjecutados,reg.sectoresProgramados);
    reg.ingresoActual=sectoresPago1*(reg.valorSector||data.valorSector);
    registros[idx]=reg;
    setData(d=>({...d,registros}));
    setVolarForm(f=>({...f,sectoresHoy:""}));
    showToast(`+${cuantos} sector${cuantos>1?"es":""} registrado${cuantos>1?"s":""} ✓`);
    setView("resumen");
  }

  function handleEliminarLog(regIdx,logIdx) {
    const registros=[...data.registros];
    const reg={...registros[regIdx]};
    reg.log=reg.log.filter((_,i)=>i!==logIdx);
    reg.sectoresEjecutados=reg.log.reduce((s,e)=>s+e.sectores,0);
    const sectoresPago2=Math.max(reg.sectoresEjecutados,reg.sectoresProgramados);
    reg.ingresoActual=sectoresPago2*(reg.valorSector||data.valorSector);
    registros[regIdx]=reg;
    setData(d=>({...d,registros}));
    showToast("Entrada eliminada");
  }

  function handleEditar(idx) {
    const r=data.registros[idx];
    setEditForm({ano:r.ano,mes:r.mes,diasProgramados:r.diasProgramados,sectoresProgramados:r.sectoresProgramados});
    setEditIdx(idx); setView("editar");
  }

  function handleGuardarEdicion() {
    const registros=[...data.registros];
    const reg={...registros[editIdx],diasProgramados:parseInt(editForm.diasProgramados),sectoresProgramados:parseInt(editForm.sectoresProgramados)};
    // Keep existing valorSector for this month
    if (!reg.valorSector) reg.valorSector = data.valorSector;
    registros[editIdx]=reg;
    setData(d=>({...d,registros}));
    setEditIdx(null); setEditForm(null);
    showToast("Actualizado ✓"); setView("resumen");
  }

  function handleEliminarMes(idx) {
    setData(d=>({...d,registros:d.registros.filter((_,i)=>i!==idx)}));
    showToast("Mes eliminado");
  }

  function handleActualizarValor() {
    const v=parseInt(nuevoValor.replace(/\D/g,""));
    if(isNaN(v)||v<=0){showToast("Valor inválido","err");return;}
    // Update valorSector globally AND recalculate all months from desdeAnio/desdeMes forward
    const registros = data.registros.map(r => {
      const despuesDeFecha = r.ano > desdeAnio || (r.ano === desdeAnio && r.mes >= desdeMes);
      if (despuesDeFecha) {
        const pago = Math.max(r.sectoresEjecutados, r.sectoresProgramados);
        return { ...r, valorSector: v, ingresoActual: pago * v };
      }
      return r;
    });
    setData({valorSector:v, registros});
    setNuevoValor("");
    showToast("Valor actualizado ✓");
    setView("resumen");
  }

  function handleResetTodo() {
    setData({ valorSector: 0, registros: [] });
    setConfirmReset(false);
    localStorage.removeItem("chequeos_onboarding_done");
    setOnboardingStep(0);
    showToast("Datos borrados ✓");
    setView("resumen");
  }

  async function pedirNotificacion() {
    if(typeof Notification==="undefined"){showToast("Tu navegador no soporta notificaciones","err");return;}
    const perm=await Notification.requestPermission();
    setNotifPerm(perm);
    if(perm==="granted"){
      showToast("Notificaciones activadas ✓");
      new Notification("✈️ Registro de Chequeos",{body:"Recuerda registrar tus sectores de hoy."});
    }
  }

  function handleExportar() {
    const total = data.registros.reduce((s,r)=>s+Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector),0);
    const ejec = data.registros.reduce((s,r)=>s+r.sectoresEjecutados,0);
    const prog = data.registros.reduce((s,r)=>s+r.sectoresProgramados,0);
    const efic = prog>0?Math.round((ejec/prog)*100):0;
    const promMensual = data.registros.length>0 ? fmt(total/data.registros.length) : "$ 0";
    setReporteData({total,ejec,prog,efic,promMensual});
    setView("reporte");
  }

  const regs = data.registros;
  const totalEjecutados = regs.reduce((s,r)=>s+r.sectoresEjecutados,0);
  const totalProgramados = regs.reduce((s,r)=>s+r.sectoresProgramados,0);
  const totalIngresos = regs.reduce((s,r)=>s+Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector),0);
  const anios = [...new Set(regs.map(r=>r.ano))].sort();
  const calcIngreso = r => Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector);
  const mejorMes = regs.length?regs.reduce((a,b)=>calcIngreso(a)>calcIngreso(b)?a:b):null;
  const peorMes = regs.length?regs.reduce((a,b)=>calcIngreso(a)<calcIngreso(b)?a:b):null;
  const mesActual = regs.find(r=>r.ano===yearNow&&r.mes===monthNow);
  const mesAnterior = regs.find(r=>r.ano===yearNow-1&&r.mes===monthNow);

  const grafData = MESES_CORTO.map((m,i)=>{
    const r=regs.find(r=>r.ano===grafAnio&&r.mes===i);
    const vs=r?(r.valorSector||data.valorSector):data.valorSector;
    const ingresos=r?Math.max(r.sectoresEjecutados,r.sectoresProgramados)*vs:0;
    return {mes:m,ingresos,ejecutados:r?r.sectoresEjecutados:0,hasData:!!r};
  }).filter(d=>d.hasData);

  const inputStyle = {width:"100%",background:"#1a2533",border:"1px solid #2d3f52",color:"#e8edf2",padding:"12px 14px",borderRadius:10,fontSize:15,boxSizing:"border-box"};
  const labelStyle = {fontSize:12,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:6};
  const btnPrimary = {width:"100%",background:"#c0392b",border:"none",color:"#fff",padding:"14px",borderRadius:12,fontSize:16,fontWeight:700,cursor:"pointer",marginBottom:12};
  const btnSecondary = {width:"100%",background:"transparent",border:"1px solid #2d3f52",color:"#7a8fa6",padding:"12px",borderRadius:12,fontSize:15,cursor:"pointer"};

  const CustomTooltip = ({active,payload,label}) => {
    if(active&&payload&&payload.length) {
      const d = payload[0].payload;
      const r = regs.find(r=>MESES_CORTO[r.mes]===label&&r.ano===grafAnio);
      const prog = r?r.sectoresProgramados:0;
      const ejec = d.ejecutados;
      const base = ejec>=prog?"ejecutado":"garantía";
      return (
        <div style={{background:"#1a2533",border:"1px solid #2d3f52",borderRadius:10,padding:"10px 14px",minWidth:160}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>{label}</div>
          <div style={{fontSize:14,color:"#2ecc71",fontWeight:700,marginBottom:4}}>💰 {fmt(payload[0].value)}</div>
          <div style={{fontSize:11,color:"#7a8fa6",marginBottom:2}}>Base de pago: <span style={{color:"#f39c12"}}>{base}</span></div>
          <div style={{fontSize:11,color:"#3498db"}}>Ejec: {ejec} · Prog: {prog}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{minHeight:"100vh",background:"#0f1923",color:"#e8edf2",fontFamily:"'Inter','Segoe UI',sans-serif",paddingBottom:90}}>

      {/* HEADER */}
      <div style={{position:"sticky",top:0,zIndex:10}}>
        <div style={{background:"linear-gradient(135deg,#1a0a0a 0%,#7a1510 45%,#c0392b 100%)",padding:"22px 20px 18px",position:"relative",overflow:"hidden"}}>
          {/* Línea decorativa sutil */}
          <div style={{position:"absolute",right:0,top:0,bottom:0,width:4,background:"rgba(255,255,255,0.08)"}}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:26,fontWeight:900,color:"#fff",letterSpacing:-0.5,lineHeight:1}}>avianca</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.55)",letterSpacing:4,textTransform:"uppercase",marginTop:4}}>TRI-R · Airbus A320</div>
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",letterSpacing:1,marginTop:4}}>v1.0</div>
          </div>
          <div style={{width:40,height:2,background:"rgba(255,255,255,0.3)",borderRadius:1,marginBottom:10}}/>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",textShadow:"0 2px 8px rgba(0,0,0,0.4)"}}>Registro de Chequeos</div>
        </div>
      </div>

      {/* ONBOARDING */}
      {onboardingStep >= 0 && (
        <div style={{position:"fixed",inset:0,background:"rgba(10,15,22,0.97)",zIndex:1000,display:"flex",flexDirection:"column",justifyContent:"space-between",padding:"40px 24px 36px"}}>
          {(() => {
            const steps = [
              {
                icon:"⚙️",
                title:"Bienvenido a Chequeos TRIR",
                desc:"Tu app para registrar y controlar tus sectores de chequeo como instructor TRI-R A320 en Avianca.",
                sub:"Primero configura el valor de tu sector en el botón Actualizar del Resumen."
              },
              {
                icon:"📋",
                title:"Programado",
                desc:"Descarga el PDF de tu itinerario mensual desde MyCrew y súbelo en la pestaña Programado.",
                sub:"La app detecta automáticamente los sectores CRI, CRA y demás códigos de chequeo. Si prefieres, también puedes ingresarlo manualmente más abajo."
              },
              {
                icon:"✈️",
                title:"Ejecutado",
                desc:"Registra los sectores que fuiste volando durante el mes.",
                sub:"Puedes ir agregándolos día a día al terminar tu jornada, o en cualquier momento del mes. La app los va sumando automáticamente."
              },
              {
                icon:"💰",
                title:"Resumen y pago",
                desc:"La app calcula automáticamente tu ingreso real basado en la garantía — siempre te pagan el mayor entre programado y ejecutado.",
                sub:"Revisa tus estadísticas, gráficas y compara mes a mes en la pantalla de Resumen. ¡Listo para empezar!"
              }
            ];
            const s = steps[onboardingStep];
            return (
              <>
                {/* Progress dots */}
                <div style={{display:"flex",justifyContent:"center",gap:8}}>
                  {steps.map((_,i)=>(
                    <div key={i} style={{width:i===onboardingStep?24:8,height:8,borderRadius:4,background:i===onboardingStep?"#c0392b":"rgba(255,255,255,0.2)",transition:"width 0.3s"}}/>
                  ))}
                </div>

                {/* Content */}
                <div style={{textAlign:"center",padding:"0 10px"}}>
                  <div style={{fontSize:64,marginBottom:24}}>{s.icon}</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#fff",marginBottom:16,lineHeight:1.3}}>{s.title}</div>
                  <div style={{fontSize:15,color:"#e8edf2",lineHeight:1.6,marginBottom:16}}>{s.desc}</div>
                  <div style={{fontSize:13,color:"#7a8fa6",lineHeight:1.6,background:"rgba(255,255,255,0.05)",borderRadius:12,padding:"12px 16px"}}>{s.sub}</div>
                </div>

                {/* Buttons */}
                <div>
                  <button onClick={()=>{
                    if(onboardingStep < steps.length-1){
                      setOnboardingStep(onboardingStep+1);
                    } else {
                      localStorage.setItem("chequeos_onboarding_done","1");
                      setOnboardingStep(-1);
                    }
                  }} style={{width:"100%",background:"#c0392b",border:"none",color:"#fff",padding:"16px",borderRadius:14,fontSize:17,fontWeight:700,cursor:"pointer",marginBottom:12}}>
                    {onboardingStep < steps.length-1 ? "Siguiente →" : "¡Empezar!"}
                  </button>
                  {onboardingStep > 0 && (
                    <button onClick={()=>setOnboardingStep(onboardingStep-1)} style={{width:"100%",background:"transparent",border:"none",color:"#7a8fa6",padding:"10px",fontSize:14,cursor:"pointer"}}>← Anterior</button>
                  )}
                  {onboardingStep === 0 && (
                    <button onClick={()=>{localStorage.setItem("chequeos_onboarding_done","1");setOnboardingStep(-1);}} style={{width:"100%",background:"transparent",border:"none",color:"#7a8fa6",padding:"10px",fontSize:14,cursor:"pointer"}}>Saltar tutorial</button>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* TOAST */}
      {toast&&<div style={{position:"fixed",top:86,left:"50%",transform:"translateX(-50%)",background:toast.type==="err"?"#c0392b":"#27ae60",color:"#fff",padding:"10px 22px",borderRadius:30,fontSize:14,fontWeight:600,zIndex:200,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",whiteSpace:"nowrap"}}>{toast.msg}</div>}

      <div style={{maxWidth:520,margin:"0 auto",padding:"0 16px"}} ref={resumenRef}>

        {/* ===== RESUMEN ===== */}
        {view==="resumen"&&(
          <div>
            {/* Valor sector */}
            <div style={{background:"#1a2533",borderRadius:14,padding:"14px 18px",marginTop:18,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:11,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase"}}>Valor por Sector</div>
                <div style={{fontSize:22,fontWeight:700,color:"#e74c3c"}}>{fmt(data.valorSector)}</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setView("config")} style={{background:"rgba(231,76,60,0.15)",border:"1px solid rgba(231,76,60,0.3)",color:"#e74c3c",padding:"7px 13px",borderRadius:8,fontSize:13,cursor:"pointer"}}>Actualizar</button>
              </div>
            </div>

            {/* Mes actual */}
            {mesActual&&(
              <div style={{background:"linear-gradient(135deg,#1e3a5f,#1a2533)",borderRadius:14,padding:"16px 18px",marginTop:14,border:"1px solid #2d5a8e"}}>
                <div style={{fontSize:11,color:"#5b9bd5",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>📅 Mes en curso — {MESES[mesActual.mes]} {mesActual.ano}</div>
                {(()=>{
                  const vs=mesActual.valorSector||data.valorSector;
                  const ejec=mesActual.sectoresEjecutados;
                  const prog=mesActual.sectoresProgramados;
                  const pago=Math.max(ejec,prog);
                  const ingresoPago=pago*vs;
                  const ingresoEjec=ejec*vs;
                  const ingresoGarantia=prog*vs;
                  return(
                    <>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6"}}>Ejecutados / Programados</div>
                          <div style={{fontSize:22,fontWeight:700}}>
                            <span style={{color:ejec>=prog?"#2ecc71":"#f39c12"}}>{ejec}</span>
                            <span style={{color:"#7a8fa6",fontSize:15}}> / {prog}</span>
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6"}}>💰 Te pagan</div>
                          <div style={{fontSize:18,fontWeight:700,color:"#2ecc71"}}>{fmt(ingresoPago)}</div>
                        </div>
                      </div>
                      <div style={{marginTop:10,background:"rgba(26,37,51,0.8)",borderRadius:10,padding:"10px 14px"}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                          <div>
                            <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Garantía</div>
                            <div style={{fontSize:13,fontWeight:600,color:"#3498db"}}>{fmt(ingresoGarantia)}</div>
                            <div style={{fontSize:10,color:"#7a8fa6"}}>{prog} sect.</div>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>Ejecutado</div>
                            <div style={{fontSize:13,fontWeight:600,color:ejec>=prog?"#2ecc71":"#f39c12"}}>{fmt(ingresoEjec)}</div>
                            <div style={{fontSize:10,color:"#7a8fa6"}}>{ejec} sect.</div>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase"}}>{ejec>=prog?"Extra":"Diferencia"}</div>
                            <div style={{fontSize:13,fontWeight:600,color:ejec>=prog?"#2ecc71":"#e74c3c"}}>
                              {ejec>=prog?"+":""}{fmt((ejec-prog)*vs)}
                            </div>
                            <div style={{fontSize:10,color:"#7a8fa6"}}>{ejec>=prog?"+":""}{ejec-prog} sect.</div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
                <div style={{marginTop:10,background:"#0f1923",borderRadius:6,height:8,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${Math.min(100,mesActual.sectoresProgramados>0?(mesActual.sectoresEjecutados/mesActual.sectoresProgramados)*100:0)}%`,background:mesActual.sectoresEjecutados>=mesActual.sectoresProgramados?"#2ecc71":"#3498db",borderRadius:6,transition:"width 0.4s"}}/>
                </div>
                {mesAnterior&&(
                  <div style={{marginTop:12,borderTop:"1px solid #2d3f52",paddingTop:12}}>
                    <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>vs {MESES[monthNow]} {yearNow-1}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div>
                        <div style={{fontSize:11,color:"#7a8fa6"}}>Año pasado</div>
                        <div style={{fontSize:13,fontWeight:600,color:"#7a8fa6"}}>{mesAnterior.sectoresEjecutados} sect. · {fmt(Math.max(mesAnterior.sectoresEjecutados,mesAnterior.sectoresProgramados)*(mesAnterior.valorSector||data.valorSector))}</div>
                      </div>
                      <div>
                        {(()=>{
                          const ingActual=Math.max(mesActual.sectoresEjecutados,mesActual.sectoresProgramados)*(mesActual.valorSector||data.valorSector);
                          const ingAnterior=Math.max(mesAnterior.sectoresEjecutados,mesAnterior.sectoresProgramados)*(mesAnterior.valorSector||data.valorSector);
                          const ds=mesActual.sectoresEjecutados-mesAnterior.sectoresEjecutados;
                          const dc=ingActual-ingAnterior;
                          const col=dc>=0?"#2ecc71":"#e74c3c";
                          return <div><div style={{fontSize:11,color:"#7a8fa6"}}>Diferencia</div><div style={{fontSize:13,fontWeight:700,color:col}}>{ds>=0?"+":""}{ds} sect. · {dc>=0?"+":""}{fmt(dc)}</div></div>;
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                {mesActual.log&&mesActual.log.length>0&&(
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Historial del mes</div>
                    {[...mesActual.log].reverse().map((entry,i)=>{
                      const regIdx=regs.findIndex(r=>r.ano===yearNow&&r.mes===monthNow);
                      const realLogIdx=mesActual.log.length-1-i;
                      return(
                        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1e2d3d"}}>
                          <div style={{fontSize:13}}><span style={{color:"#7a8fa6"}}>{entry.fecha}</span><span style={{marginLeft:10,color:"#3498db",fontWeight:600}}>+{entry.sectores} sector{entry.sectores>1?"es":""}</span></div>
                          <button onClick={()=>handleEliminarLog(regIdx,realLogIdx)} style={{background:"none",border:"none",color:"#e74c3c",cursor:"pointer",fontSize:13}}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}



            {/* GRÁFICA */}
            {regs.length>0&&(
              <>
                <div style={{background:"#1a2533",borderRadius:14,padding:"16px 18px",marginTop:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:700}}>📈 Ingresos por mes</div>
                    <select value={grafAnio} onChange={e=>setGrafAnio(parseInt(e.target.value))} style={{background:"#0f1923",border:"1px solid #2d3f52",color:"#e8edf2",padding:"4px 10px",borderRadius:8,fontSize:13}}>
                      {anios.map(a=><option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {grafData.length>0&&grafData.some(d=>d.ingresos>0)?(
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={grafData} margin={{top:0,right:0,left:0,bottom:0}}>
                        <XAxis dataKey="mes" tick={{fill:"#7a8fa6",fontSize:11}} axisLine={false} tickLine={false}/>
                        <YAxis hide/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Bar dataKey="ingresos" radius={[6,6,0,0]}>
                          {grafData.map((entry,i)=>(
                            <Cell key={i} fill={entry.mes===MESES_CORTO[monthNow]&&grafAnio===yearNow?"#e74c3c":"#3498db"}/>
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ):<div style={{textAlign:"center",color:"#7a8fa6",padding:20,fontSize:13}}>Aún sin ingresos ejecutados en {grafAnio}.<br/>Registra sectores en "Ejecutado" para ver la gráfica.</div>}

                </div>

                {/* AÑO EN CURSO */}
                {(()=>{
                  const rsAnio=regs.filter(r=>r.ano===yearNow);
                  if(rsAnio.length===0) return null;
                  const ejecAnio=rsAnio.reduce((s,r)=>s+r.sectoresEjecutados,0);
                  const progAnio=rsAnio.reduce((s,r)=>s+r.sectoresProgramados,0);
                  const ingAnio=rsAnio.reduce((s,r)=>s+Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector),0);
                  const eficAnio=progAnio>0?Math.round((ejecAnio/progAnio)*100):0;
                  return(
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
                    {label:"Sectores Ejec.",value:`${totalEjecutados} / ${totalProgramados}`,color:"#3498db"},
                    {label:"Prom. Mensual",value:regs.length>0?fmt(totalIngresos/regs.length):"$ 0",color:"#f39c12"},
                    {label:"Eficiencia Global",value:`${totalProgramados>0?Math.round((totalEjecutados/totalProgramados)*100):0}%`,color:totalEjecutados>=totalProgramados?"#2ecc71":"#e74c3c"},
                  ].map((k,i)=>(
                    <div key={i} style={{background:"#1a2533",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1}}>{k.label}</div>
                      <div style={{fontSize:18,fontWeight:700,color:k.color,marginTop:4}}>{k.value}</div>
                    </div>
                  ))}
                </div>

                {mejorMes&&(()=>{
                  const mpTabs = ["Global", ...anios.map(a=>String(a))];
                  const mpRegs = mpTab==="Global" ? regs : regs.filter(r=>r.ano===parseInt(mpTab));
                  const calcIng = r => Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector);
                  const mejor = mpRegs.length ? mpRegs.reduce((a,b)=>calcIng(a)>calcIng(b)?a:b) : null;
                  const peor  = mpRegs.length ? mpRegs.reduce((a,b)=>calcIng(a)<calcIng(b)?a:b) : null;
                  return(
                    <div style={{background:"#1a2533",borderRadius:14,padding:"14px 18px",marginTop:12}}>
                      <div style={{fontSize:11,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Destacados</div>
                      {/* Pestañas */}
                      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto"}}>
                        {mpTabs.map(t=>(
                          <button key={t} onClick={()=>setMpTab(t)} style={{
                            background:mpTab===t?"#c0392b":"rgba(255,255,255,0.06)",
                            border:mpTab===t?"none":"1px solid #2d3f52",
                            color:mpTab===t?"#fff":"#7a8fa6",
                            padding:"5px 14px",borderRadius:20,fontSize:12,
                            fontWeight:mpTab===t?700:400,cursor:"pointer",whiteSpace:"nowrap"
                          }}>{t}</button>
                        ))}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase"}}>🏆 Mejor Mes</div>
                          {mejor ? <>
                            <div style={{fontSize:14,fontWeight:600,color:"#2ecc71",marginTop:4}}>{MESES[mejor.mes]} {mejor.ano}</div>
                            <div style={{fontSize:13,color:"#7a8fa6"}}>{fmt(calcIng(mejor))}</div>
                          </> : <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>Sin datos</div>}
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#7a8fa6",textTransform:"uppercase"}}>📉 Peor Mes</div>
                          {peor ? <>
                            <div style={{fontSize:14,fontWeight:600,color:"#e74c3c",marginTop:4}}>{MESES[peor.mes]} {peor.ano}</div>
                            <div style={{fontSize:13,color:"#7a8fa6"}}>{fmt(calcIng(peor))}</div>
                          </> : <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>Sin datos</div>}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* RESUMEN POR AÑO CON PESTAÑAS */}
                {(()=>{
                  const tabs = ["Global", ...anios.map(a=>String(a))];
                  const tabAnio = resTabAnio;
                  const setTabAnio = setResTabAnio;
                  const isGlobal = tabAnio === "Global";
                  const rs = isGlobal ? regs : regs.filter(r=>r.ano===parseInt(tabAnio));
                  const ejec = rs.reduce((s,r)=>s+r.sectoresEjecutados,0);
                  const prog = rs.reduce((s,r)=>s+r.sectoresProgramados,0);
                  const ing = rs.reduce((s,r)=>s+Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector),0);
                  const efic = prog>0?Math.round((ejec/prog)*100):0;
                  const meses = rs.length;
                  return(
                    <div style={{background:"#1a2533",borderRadius:14,padding:"14px 18px",marginTop:12}}>
                      <div style={{fontSize:11,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Resumen por período</div>
                      {/* Pestañas */}
                      <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
                        {tabs.map(t=>(
                          <button key={t} onClick={()=>setResTabAnio(t)} style={{
                            background:tabAnio===t?"#c0392b":"rgba(255,255,255,0.06)",
                            border:tabAnio===t?"none":"1px solid #2d3f52",
                            color:tabAnio===t?"#fff":"#7a8fa6",
                            padding:"5px 14px",borderRadius:20,fontSize:12,
                            fontWeight:tabAnio===t?700:400,cursor:"pointer",whiteSpace:"nowrap"
                          }}>{t}</button>
                        ))}
                      </div>
                      {/* Datos */}
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

            <div style={{marginTop:20}}>
              <div style={{fontSize:12,color:"#7a8fa6",letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Historial por Mes</div>
              {regs.length===0&&(
                <div style={{background:"#1a2533",borderRadius:14,padding:30,textAlign:"center",color:"#7a8fa6"}}>
                  <div style={{fontSize:36,marginBottom:8}}>✈️</div>
                  <div>Aún no hay registros.<br/>Toca "Programado" para comenzar.</div>
                </div>
              )}
              {anios.slice().reverse().map(anio=>{
                const regsAnio=[...regs].filter(r=>r.ano===anio).reverse();
                const expanded=!!aniosExpanded[anio];
                const ingAnio=regsAnio.reduce((s,r)=>s+Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector),0);
                return(
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
                    {expanded&&(
                      <div style={{border:"1px solid #2d3f52",borderTop:"none",borderRadius:"0 0 14px 14px",overflow:"hidden"}}>
                        {regsAnio.map((r,i)=>{
                          const realIdx=regs.findIndex(x=>x.ano===r.ano&&x.mes===r.mes);
                          const diff=r.sectoresEjecutados-r.sectoresProgramados;
                          return(
                            <div key={i} style={{background:"#1a2533",padding:"12px 16px",borderBottom:i<regsAnio.length-1?"1px solid #1e2d3d":"none"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                                <div>
                                  <div style={{fontSize:15,fontWeight:700}}>{MESES[r.mes]}</div>
                                  <div style={{fontSize:12,color:"#7a8fa6",marginTop:4}}>{r.diasProgramados} días programados</div>
                                  <div style={{fontSize:12,color:"#7a8fa6",marginTop:2}}>
                                    {r.sectoresEjecutados}/{r.sectoresProgramados} sectores
                                    <span style={{marginLeft:6,color:diff>=0?"#2ecc71":"#e74c3c",fontWeight:600}}>({diff>=0?"+":""}{diff})</span>
                                  </div>
                                  {r.valorSector&&(
                                    <div style={{fontSize:11,color:"#5b9bd5",marginTop:2}}>Valor: {fmt(r.valorSector)}/sector</div>
                                  )}
                                </div>
                                <div style={{textAlign:"right"}}>
                                  <div style={{fontSize:16,fontWeight:700,color:"#2ecc71"}}>{fmt(Math.max(r.sectoresEjecutados,r.sectoresProgramados)*(r.valorSector||data.valorSector))}</div>
                                  <div style={{
                                    fontSize:11,fontWeight:700,
                                    color:diff>=0?"#2ecc71":"#f39c12",
                                    background:diff>=0?"rgba(46,204,113,0.15)":"rgba(243,156,18,0.15)",
                                    border:`1px solid ${diff>=0?"rgba(46,204,113,0.3)":"rgba(243,156,18,0.3)"}`,
                                    borderRadius:6,padding:"2px 7px",marginTop:3,display:"inline-block"
                                  }}>{diff>=0?"▲ extra":"▼ garantía"}</div>
                                  <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                                    <button onClick={()=>handleEditar(realIdx)} style={{background:"rgba(52,152,219,0.15)",border:"none",color:"#3498db",padding:"4px 10px",borderRadius:6,fontSize:12,cursor:"pointer"}}>Editar</button>
                                    <button onClick={()=>handleEliminarMes(realIdx)} style={{background:"rgba(231,76,60,0.15)",border:"none",color:"#e74c3c",padding:"4px 10px",borderRadius:6,fontSize:12,cursor:"pointer"}}>Eliminar</button>
                                  </div>
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

        {/* ===== PLANEAR ===== */}
        {view==="planear"&&(
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Programado</div>
            <div style={{fontSize:13,color:"#7a8fa6",marginBottom:20}}>Sube el PDF de tu programación o ingrésala manualmente.</div>

            {!pdfParsed&&(
              <div style={{marginBottom:20}}>
                <label style={{...labelStyle,marginBottom:10}}>📄 Importar desde PDF de MyCrew</label>
                <label style={{display:"block",background:"rgba(52,152,219,0.1)",border:"2px dashed rgba(52,152,219,0.4)",borderRadius:12,padding:"24px",textAlign:"center",cursor:"pointer"}}>
                  <input type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handlePdfImport(e.target.files[0])}/>
                  {pdfLoading
                    ? <div style={{color:"#3498db",fontSize:14}}>⏳ Leyendo PDF...</div>
                    : <div><div style={{fontSize:32,marginBottom:8}}>📂</div><div style={{color:"#3498db",fontSize:14,fontWeight:600}}>Toca para seleccionar el PDF</div><div style={{color:"#7a8fa6",fontSize:12,marginTop:4}}>Detecta CRI, CRA, CRNU, LRC, CRF, CRQA, LRQA</div></div>
                  }
                </label>
              </div>
            )}

            {pdfParsed&&(
              <div style={{marginBottom:20}}>
                <div style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:12,padding:"16px 18px",marginBottom:12}}>
                  <div style={{fontSize:12,color:"#2ecc71",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>✓ PDF leído correctamente</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>Mes detectado</div><div style={{fontSize:16,fontWeight:700}}>{pdfParsed.mes!==null?MESES[pdfParsed.mes]+" "+pdfParsed.ano:"No detectado"}</div></div>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>Días con chequeo</div><div style={{fontSize:16,fontWeight:700,color:"#3498db"}}>{pdfParsed.diasProgramados}</div></div>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>Sectores programados</div><div style={{fontSize:22,fontWeight:700,color:"#2ecc71"}}>{pdfParsed.sectoresProgramados}</div></div>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>Ingreso potencial</div><div style={{fontSize:15,fontWeight:700,color:"#f39c12"}}>{fmt(pdfParsed.sectoresProgramados*data.valorSector)}</div></div>
                  </div>
                  <div style={{borderTop:"1px solid rgba(46,204,113,0.2)",paddingTop:10}}>
                    <div style={{fontSize:11,color:"#7a8fa6",marginBottom:6}}>Desglose por código</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {Object.entries(pdfParsed.detalle).map(([code,cnt])=>(
                        <div key={code} style={{background:"rgba(52,152,219,0.15)",border:"1px solid rgba(52,152,219,0.3)",borderRadius:6,padding:"3px 10px",fontSize:13}}>
                          <span style={{color:"#3498db",fontWeight:700}}>{code}</span> <span>{cnt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button onClick={handleConfirmarPdf} style={btnPrimary}>Confirmar e importar</button>
                <button onClick={()=>setPdfParsed(null)} style={{...btnSecondary,marginBottom:12}}>Volver a subir otro PDF</button>
              </div>
            )}

            {!pdfParsed&&(
              <>
                <div style={{display:"flex",alignItems:"center",gap:10,margin:"4px 0 20px",color:"#7a8fa6",fontSize:13}}>
                  <div style={{flex:1,height:1,background:"#2d3f52"}}/> o ingresa manualmente <div style={{flex:1,height:1,background:"#2d3f52"}}/>
                </div>
                <div style={{marginBottom:16}}><label style={labelStyle}>Año</label><input type="number" value={planForm.ano} onChange={e=>setPlanForm(f=>({...f,ano:e.target.value}))} style={inputStyle}/></div>
                <div style={{marginBottom:16}}><label style={labelStyle}>Mes</label><select value={planForm.mes} onChange={e=>setPlanForm(f=>({...f,mes:parseInt(e.target.value)}))} style={inputStyle}>{MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}</select></div>
                <div style={{marginBottom:16}}><label style={labelStyle}>Días de chequeo programados</label><input type="number" value={planForm.diasProgramados} placeholder="ej: 8" onChange={e=>setPlanForm(f=>({...f,diasProgramados:e.target.value}))} style={inputStyle}/></div>
                <div style={{marginBottom:20}}><label style={labelStyle}>Sectores programados</label><input type="number" value={planForm.sectoresProgramados} placeholder="ej: 16" onChange={e=>setPlanForm(f=>({...f,sectoresProgramados:e.target.value}))} style={inputStyle}/></div>
                {planForm.sectoresProgramados&&(
                  <div style={{background:"rgba(52,152,219,0.1)",border:"1px solid rgba(52,152,219,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:20}}>
                    <div style={{fontSize:12,color:"#7a8fa6"}}>Ingreso potencial si se ejecutan todos</div>
                    <div style={{fontSize:22,fontWeight:700,color:"#3498db"}}>{fmt(parseInt(planForm.sectoresProgramados||0)*data.valorSector)}</div>
                  </div>
                )}
                <button onClick={handlePlanear} style={btnPrimary}>Guardar programación</button>
                <button onClick={()=>setView("resumen")} style={btnSecondary}>Cancelar</button>
              </>
            )}
          </div>
        )}

        {/* ===== VOLAR HOY ===== */}
        {view==="volar"&&(
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>Ejecutado</div>
            <div style={{fontSize:13,color:"#7a8fa6",marginBottom:20}}>¿Cuántos sectores volaste hoy?</div>
            {regs.length===0 ? (
              <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.3)",borderRadius:12,padding:16,marginBottom:16,fontSize:13,color:"#e74c3c"}}>
                Primero sube tu programación en "Programado".
              </div>
            ) : (
            <div style={{marginBottom:16}}><label style={labelStyle}>Mes</label>
              <select
                value={regs.find(r=>r.ano===volarForm.ano&&r.mes===volarForm.mes) ? `${volarForm.ano}-${volarForm.mes}` : `${regs[regs.length-1].ano}-${regs[regs.length-1].mes}`}
                onChange={e=>{const[a,m]=e.target.value.split("-");setVolarForm(f=>({...f,ano:parseInt(a),mes:parseInt(m)}));}}
                style={inputStyle}>
                {[...regs].reverse().map(r=><option key={`${r.ano}-${r.mes}`} value={`${r.ano}-${r.mes}`}>{MESES[r.mes]} {r.ano}</option>)}
              </select>
            </div>
            )}
            <div style={{marginBottom:20}}><label style={labelStyle}>Sectores volados hoy</label>
              <input type="number" value={volarForm.sectoresHoy} placeholder="ej: 2" min="1" onChange={e=>setVolarForm(f=>({...f,sectoresHoy:e.target.value}))} style={{...inputStyle,fontSize:32,fontWeight:700,textAlign:"center",color:"#2ecc71"}}/>
            </div>
            {(()=>{
              const r=regs.find(r=>r.mes===volarForm.mes&&r.ano===volarForm.ano);
              if(!r)return null;
              const nuevo=r.sectoresEjecutados+parseInt(volarForm.sectoresHoy||0);
              return(
                <div style={{background:"rgba(46,204,113,0.1)",border:"1px solid rgba(46,204,113,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:20}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>Total acumulado</div><div style={{fontSize:20,fontWeight:700,color:"#2ecc71"}}>{nuevo} / {r.sectoresProgramados}</div></div>
                    <div><div style={{fontSize:11,color:"#7a8fa6"}}>Ingreso acumulado</div><div style={{fontSize:18,fontWeight:700,color:"#2ecc71"}}>{fmt(nuevo*data.valorSector)}</div></div>
                  </div>
                </div>
              );
            })()}
            <button onClick={handleVolar} style={btnPrimary}>Registrar</button>
            <button onClick={()=>setView("resumen")} style={btnSecondary}>Cancelar</button>
          </div>
        )}

        {/* ===== EDITAR ===== */}
        {view==="editar"&&editForm&&(
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:20}}>Editar programación</div>
            <div style={{marginBottom:16}}><label style={labelStyle}>Días programados</label><input type="number" value={editForm.diasProgramados} onChange={e=>setEditForm(f=>({...f,diasProgramados:e.target.value}))} style={inputStyle}/></div>
            <div style={{marginBottom:20}}><label style={labelStyle}>Sectores programados</label><input type="number" value={editForm.sectoresProgramados} onChange={e=>setEditForm(f=>({...f,sectoresProgramados:e.target.value}))} style={inputStyle}/></div>
            <button onClick={handleGuardarEdicion} style={btnPrimary}>Guardar</button>
            <button onClick={()=>{setView("resumen");setEditIdx(null);}} style={btnSecondary}>Cancelar</button>
          </div>
        )}

        {/* ===== CONFIG ===== */}
        {view==="reporte"&&reporteData&&(
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:4}}>📄 Resumen TRI-R</div>
            <div style={{fontSize:12,color:"#7a8fa6",marginBottom:16}}>{new Date().toLocaleDateString("es-CO",{year:"numeric",month:"long",day:"numeric"})}</div>

            {/* KPIs */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[
                {label:"Total Ingresos",value:fmt(reporteData.total),color:"#2ecc71"},
                {label:"Prom. Mensual",value:fmt(reporteData.promMensual),color:"#3498db"},
                {label:"Ejec / Prog",value:`${reporteData.ejec} / ${reporteData.prog}`,color:"#f39c12"},
                {label:"Eficiencia",value:`${reporteData.efic}%`,color:reporteData.efic>=90?"#2ecc71":reporteData.efic>=70?"#f39c12":"#e74c3c"},
              ].map((k,i)=>(
                <div key={i} style={{background:"#1a2533",borderRadius:12,padding:"12px 14px"}}>
                  <div style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1}}>{k.label}</div>
                  <div style={{fontSize:17,fontWeight:700,color:k.color,marginTop:3}}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Tabla historial */}
            <div style={{background:"#1a2533",borderRadius:14,overflow:"hidden",marginBottom:16}}>
              <div style={{display:"grid",gridTemplateColumns:"1.4fr 0.8fr 0.8fr 1fr",background:"#162030",padding:"8px 12px"}}>
                {["Mes","Prog.","Ejec.","Ingreso"].map(h=><div key={h} style={{fontSize:10,color:"#7a8fa6",textTransform:"uppercase",letterSpacing:1}}>{h}</div>)}
              </div>
              {[...data.registros].reverse().map((r,i)=>{
                const vs=r.valorSector||data.valorSector;
                const pago=Math.max(r.sectoresEjecutados,r.sectoresProgramados)*vs;
                const diff=r.sectoresEjecutados-r.sectoresProgramados;
                return(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"1.4fr 0.8fr 0.8fr 1fr",padding:"10px 12px",borderBottom:"1px solid #1e2d3d"}}>
                    <div style={{fontSize:13,fontWeight:600}}>{MESES[r.mes].slice(0,3)} {r.ano}</div>
                    <div style={{fontSize:13,color:"#7a8fa6"}}>{r.sectoresProgramados}</div>
                    <div style={{fontSize:13,color:diff>=0?"#2ecc71":"#f39c12"}}>{r.sectoresEjecutados}</div>
                    <div style={{fontSize:13,fontWeight:600,color:"#2ecc71"}}>{fmt(pago)}</div>
                  </div>
                );
              })}
            </div>

            <div style={{fontSize:11,color:"#7a8fa6",textAlign:"center",marginBottom:20}}>
              Valor actual: {fmt(data.valorSector)}/sector · {data.registros.length} meses registrados
            </div>

            <div style={{background:"rgba(52,152,219,0.1)",border:"1px solid rgba(52,152,219,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:16,fontSize:13,color:"#3498db"}}>
              📱 Para guardar: toca los <strong>tres puntos (···)</strong> arriba a la derecha → <strong>Compartir</strong> → <strong>Imprimir</strong> o <strong>Guardar en Archivos</strong>
            </div>

            <button onClick={()=>setView("exportar")} style={{width:"100%",background:"transparent",border:"1px solid #2d3f52",color:"#7a8fa6",padding:"12px",borderRadius:12,fontSize:15,cursor:"pointer"}}>Volver</button>
          </div>
        )}

        {view==="config"&&(
          <div style={{marginTop:20}}>
            <div style={{fontSize:18,fontWeight:700,marginBottom:20}}>Actualizar valor del sector</div>
            <div style={{background:"#1a2533",borderRadius:14,padding:"14px 18px",marginBottom:20}}>
              <div style={{fontSize:12,color:"#7a8fa6"}}>Valor actual</div>
              <div style={{fontSize:24,fontWeight:700,color:"#e74c3c"}}>{fmt(data.valorSector)}</div>
            </div>
            <label style={labelStyle}>Nuevo valor (COP)</label>
            <input type="number" value={nuevoValor} placeholder="Ingresa el nuevo valor" onChange={e=>setNuevoValor(e.target.value)} style={{...inputStyle,marginBottom:16}}/>
            
            <label style={{...labelStyle,marginBottom:6}}>Aplicar desde</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <select value={desdeMes} onChange={e=>setDesdeMes(parseInt(e.target.value))} style={inputStyle}>
                {MESES.map((m,i)=><option key={i} value={i}>{m}</option>)}
              </select>
              <select value={desdeAnio} onChange={e=>setDesdeAnio(parseInt(e.target.value))} style={inputStyle}>
                {[yearNow-1,yearNow,yearNow+1].map(a=><option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div style={{background:"rgba(243,156,18,0.1)",border:"1px solid rgba(243,156,18,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13,color:"#f39c12"}}>
              ✓ El nuevo valor aplicará desde <strong>{MESES[desdeMes]} {desdeAnio}</strong> en adelante. Los meses anteriores conservan su valor original.
            </div>
            <button onClick={handleActualizarValor} style={btnPrimary}>Actualizar valor</button>
            <button onClick={()=>setView("resumen")} style={{...btnSecondary,marginBottom:24}}>Cancelar</button>

            <div style={{borderTop:"1px solid #2d3f52",paddingTop:20}}>
              <div style={{fontSize:13,color:"#7a8fa6",marginBottom:12}}>Zona de peligro</div>
              {!confirmReset ? (
                <button onClick={()=>setConfirmReset(true)} style={{width:"100%",background:"rgba(231,76,60,0.12)",border:"1px solid rgba(231,76,60,0.4)",color:"#e74c3c",padding:"12px",borderRadius:12,fontSize:15,fontWeight:600,cursor:"pointer"}}>🗑️ Borrar todos los datos</button>
              ) : (
                <div style={{background:"rgba(231,76,60,0.1)",border:"1px solid rgba(231,76,60,0.4)",borderRadius:12,padding:"16px"}}>
                  <div style={{fontSize:14,color:"#e74c3c",fontWeight:600,marginBottom:4}}>⚠️ ¿Estás seguro?</div>
                  <div style={{fontSize:13,color:"#7a8fa6",marginBottom:14}}>Se eliminarán todos los meses registrados. No se puede deshacer.</div>
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

      {/* BOTTOM NAV */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#111d2b",borderTop:"1px solid #1e2d3d",display:"flex",justifyContent:"space-around",padding:"10px 0 16px"}}>
        {[{id:"resumen",label:"Resumen",icon:"📊"},{id:"planear",label:"Programado",icon:"📋"},{id:"volar",label:"Ejecutado",icon:"✈️"}].map(tab=>(
          <button key={tab.id} onClick={()=>{
            if(tab.id==="volar"&&regs.length>0){
              const last=regs[regs.length-1];
              setVolarForm(f=>({...f,ano:last.ano,mes:last.mes}));
            }
            setView(tab.id);setEditIdx(null);setPdfParsed(null);
          }} style={{background:"none",border:"none",color:view===tab.id?"#e74c3c":"#7a8fa6",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,fontSize:11,fontWeight:view===tab.id?700:400}}>
            <span style={{fontSize:22}}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
