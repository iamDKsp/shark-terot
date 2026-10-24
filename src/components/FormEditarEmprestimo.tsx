"use client";

import { updateEmprestimo } from "@/app/emprestimos/[id]/actions";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Calendar, User, Wallet, Settings, FileText, CheckCircle2, Calculator, AlertTriangle } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SearchableSelect from "@/components/SearchableSelect";
import AtrasoField from "@/components/AtrasoField";

interface Cliente  { id: string; nome: string; telefone: string; }
interface Parceiro { id: string; nome: string; }
interface ParcelaEmp { id: string; numero: number; valor: number; data_vencimento: Date | string; status: string; }
interface EmprestimoEditar {
  id: string; cliente_id: string; parceiro_id: string | null;
  valor_emprestado: number; taxa_juros: number; taxa_multa: number; juros_atraso: number;
  atraso_tipo?: string | null; atraso_valor?: number | null;
  data_inicio: Date | string | null; data_vencimento: Date | string;
  tipo_pagamento: string; frequencia: string; categoria: string;
  observacoes: string | null; status: string; parcelas: ParcelaEmp[];
}
interface Props { emprestimo: EmprestimoEditar; clientes: Cliente[]; parceiros: Parceiro[]; }
type TipoPagamento = "a_vista" | "a_vista_juros" | "juros_compostos" | "parcelado" | "juros_mensais" | "parcela_juros_mes";
type Frequencia = "diario" | "semanal" | "quinzenal" | "mensal";

const toInputDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const dt = new Date(d as string);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2,"0")}-${String(dt.getUTCDate()).padStart(2,"0")}`;
};
const addMonthsCapped = (date: Date, months: number) => {
  const d = new Date(date.valueOf());
  const exp = (d.getMonth() + months) % 12;
  d.setMonth(d.getMonth() + months);
  if (d.getMonth() !== (exp < 0 ? exp + 12 : exp)) d.setDate(0);
  return d;
};

export default function FormEditarEmprestimo({ emprestimo, clientes, parceiros }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayStep, setOverlayStep] = useState(0);
  const [clienteId, setClienteId] = useState(emprestimo.cliente_id);
  const [parceiroId, setParceiroId] = useState(emprestimo.parceiro_id || "");
  const [valor, setValor] = useState<number>(emprestimo.valor_emprestado);
  const [tipoPagamento, setTipoPagamento] = useState<TipoPagamento>((emprestimo.tipo_pagamento as TipoPagamento) || "a_vista_juros");
  const [frequencia, setFrequencia] = useState<Frequencia>((emprestimo.frequencia as Frequencia) || "mensal");
  const [taxaJuros, setTaxaJuros] = useState<number>(emprestimo.taxa_juros);
  const [periodos, setPeriodos] = useState<number>(() => { const ab = emprestimo.parcelas.filter(p => p.status === "aberto"); return ab.length || 1; });
  const [dataInicio, setDataInicio] = useState(toInputDate(emprestimo.data_inicio || emprestimo.data_vencimento));
  const [vencimentoPrimeira, setVencimentoPrimeira] = useState(() => { const ab = emprestimo.parcelas.filter(p => p.status === "aberto"); return ab.length > 0 ? toInputDate(ab[0].data_vencimento) : toInputDate(emprestimo.data_vencimento); });
  const [categoria, setCategoria] = useState(emprestimo.categoria || "Sem categoria");
  const [observacoes, setObservacoes] = useState(emprestimo.observacoes || "");
  const [recriarParcelas, setRecriarParcelas] = useState(false);
  const parcelasPagas = emprestimo.parcelas.filter(p => !p.status.startsWith("aberto"));
  const parcelasAbertas = emprestimo.parcelas.filter(p => p.status === "aberto");

  const addPeriod = (dateStr: string, index: number) => {
    const [y, mo, d] = dateStr.split("-").map(Number);
    let dt = new Date(y, mo - 1, d, 12, 0, 0);
    if (frequencia === "diario") dt.setDate(dt.getDate() + index);
    else if (frequencia === "semanal") dt.setDate(dt.getDate() + index * 7);
    else if (frequencia === "quinzenal") dt.setDate(dt.getDate() + index * 15);
    else if (frequencia === "mensal") dt = addMonthsCapped(dt, index);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  };
  const gerarParcelas = () => {
    if (valor <= 0 || !dataInicio) return [];
    const list: { numero: number; valor: number; data_vencimento: string }[] = [];
    const vencBaseUnica = vencimentoPrimeira || addPeriod(dataInicio, 1);
    if (tipoPagamento === "a_vista") list.push({ numero: 1, valor, data_vencimento: vencBaseUnica });
    else if (tipoPagamento === "a_vista_juros") list.push({ numero: 1, valor: Number((valor * (1 + taxaJuros / 100)).toFixed(2)), data_vencimento: vencBaseUnica });
    else if (tipoPagamento === "juros_compostos") list.push({ numero: 1, valor: Number((valor * Math.pow(1 + taxaJuros / 100, periodos)).toFixed(2)), data_vencimento: vencimentoPrimeira || addPeriod(dataInicio, periodos) });
    else if (tipoPagamento === "parcelado") { const vp = Number((valor * (1 + taxaJuros / 100) / periodos).toFixed(2)); for (let i = 0; i < periodos; i++) list.push({ numero: i+1, valor: vp, data_vencimento: addPeriod(vencimentoPrimeira, i) }); }
    else if (tipoPagamento === "juros_mensais") { const vj = Number((valor * (taxaJuros / 100)).toFixed(2)); for (let i = 0; i < periodos; i++) { const il = i === periodos - 1; list.push({ numero: i+1, valor: il ? Number((valor + vj).toFixed(2)) : vj, data_vencimento: addPeriod(vencimentoPrimeira, i) }); } }
    else if (tipoPagamento === "parcela_juros_mes") { const vp = Number(((valor / periodos) + (valor * (taxaJuros / 100))).toFixed(2)); for (let i = 0; i < periodos; i++) list.push({ numero: i+1, valor: vp, data_vencimento: addPeriod(vencimentoPrimeira, i) }); }
    return list;
  };
  const parcelasSimuladas = recriarParcelas ? gerarParcelas() : [];
  const dataVencimentoFinal = parcelasSimuladas.length > 0 ? parcelasSimuladas[parcelasSimuladas.length - 1].data_vencimento : vencimentoPrimeira || toInputDate(emprestimo.data_vencimento);
  const formatBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  const formatDataBr = (ds: string | Date) => { const s = typeof ds === "string" ? ds : toInputDate(ds); const p = s.split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s; };
  const getDescricaoTipo = () => { switch (tipoPagamento) { case "a_vista": return "Pagamento único sem juros."; case "a_vista_juros": return "Pagamento único com juros simples."; case "juros_compostos": return "Juros compostos por período."; case "parcelado": return "Parcelado em parcelas iguais."; case "juros_mensais": return "Juros mensais + principal no final."; case "parcela_juros_mes": return "Parcela com juros embutido todo mês."; } };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("tipoPagamento", tipoPagamento);
    formData.set("frequencia", frequencia);
    formData.set("categoria", categoria);
    formData.set("dataVencimento", dataVencimentoFinal);
    formData.set("recriarParcelas", recriarParcelas ? "true" : "false");
    formData.set("parcelasJson", recriarParcelas ? JSON.stringify(parcelasSimuladas) : "[]");
    
    setShowOverlay(true);
    setOverlayStep(1);

    startTransition(async () => {
      try {
        const res = await updateEmprestimo(emprestimo.id, formData);
        if (res?.success && res.redirectUrl) {
          setOverlayStep(2);
          setTimeout(() => {
            router.push(res.redirectUrl);
            router.refresh();
          }, 450);
        } else {
          alert("Erro ao salvar.");
          setShowOverlay(false);
        }
      } catch {
        alert("Erro ao salvar.");
        setShowOverlay(false);
      }
    });
  };

  return (
    <div className="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto space-y-6">
      <Link href={`/emprestimos/${emprestimo.id}`} className="flex items-center space-x-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" /><span>Voltar para Detalhes</span>
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Editar Empréstimo</h1>
        <p className="text-slate-500">Altere os dados. Parcelas já pagas são sempre preservadas.</p>
      </div>
      {parcelasPagas.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">{parcelasPagas.length} parcela{parcelasPagas.length !== 1 ? "s" : ""} já paga{parcelasPagas.length !== 1 ? "s" : ""}</p>
            <p className="text-sm text-amber-700 mt-0.5">Ao recriar, apenas as {parcelasAbertas.length} em aberto serão substituídas.</p>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-6 pb-20">
        {/* Secao 1: Cliente */}
        <div className="bg-white border border-slate-200 shadow-md rounded-2xl relative transition-shadow hover:shadow-lg z-10">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500 rounded-l-2xl" />
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-emerald-50 rounded-xl"><User className="w-5 h-5 text-emerald-600" /></div>
              <div><h2 className="text-base font-black text-slate-800 tracking-tight">Dados do Cliente</h2><p className="text-sm text-slate-500 mt-0.5">Vincule o empréstimo.</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">Pessoa <span className="text-rose-500">*</span></label>
                <div className="bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-emerald-500 hover:border-emerald-400 transition-colors">
                  <SearchableSelect name="clienteId" value={clienteId} onChange={setClienteId} options={clientes} placeholder="Selecione uma pessoa..." />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Quem Emprestou?</label>
                <select name="parceiroId" value={parceiroId} onChange={(e) => setParceiroId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium hover:border-emerald-400 transition-colors cursor-pointer">
                  <option value="">Eu (Administrador)</option>
                  {parceiros.map((p) => <option key={p.id} value={p.id}>{p.nome} (Parceiro)</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
        {/* Secao 2: Valores */}
        <div className="bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500" />
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-blue-50 rounded-xl"><Wallet className="w-5 h-5 text-blue-600" /></div>
              <div><h2 className="text-base font-black text-slate-800 tracking-tight">Valores e Modalidade</h2><p className="text-sm text-slate-500 mt-0.5">Defina o montante e a forma de pagamento.</p></div>
            </div>
            <div className="space-y-8">
              <div className="space-y-3">
                <label className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">Valor Principal <span className="text-rose-500">*</span></label>
                <div className="relative group max-w-sm">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none"><span className="text-sm font-black text-emerald-600">R$</span></div>
                  <input type="number" name="valorEmprestado" required min="1" step="any" placeholder="0,00" value={valor || ""} onChange={(e) => setValor(Number(e.target.value))} className="w-full bg-emerald-50/50 border-2 border-emerald-500/50 rounded-xl pl-10 pr-4 py-3.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 text-emerald-700 font-black transition-all shadow-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                </div>
              </div>
              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Tipo de Pagamento</label>
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">
                  {[{ id: "a_vista", label: "À Vista" }, { id: "a_vista_juros", label: "À Vista + Juros" }, { id: "juros_compostos", label: "Juros Compostos" }, { id: "parcelado", label: "Parcelado" }, { id: "juros_mensais", label: "Juros Mensais" }, { id: "parcela_juros_mes", label: "Parcela + Juros/Mês" }].map((tipo) => (
                    <button key={tipo.id} type="button" onClick={() => setTipoPagamento(tipo.id as TipoPagamento)} className={`relative py-3.5 px-4 rounded-xl border text-sm font-bold transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${tipoPagamento === tipo.id ? "bg-emerald-600 text-white border-emerald-600 shadow-md scale-[1.02]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
                      {tipoPagamento === tipo.id && <CheckCircle2 className="w-4 h-4 absolute left-3 opacity-50" />}{tipo.label}
                    </button>
                  ))}
                </div>
                <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-100 flex items-start gap-3 mt-2">
                  <Calculator className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-800 font-medium leading-relaxed">{getDescricaoTipo()}</p>
                </div>
                {tipoPagamento === "a_vista" && (emprestimo.taxa_juros > 0 || parcelasPagas.length > 0) && (
                  <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200 flex items-start gap-3 mt-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 font-semibold leading-relaxed">
                      A modalidade &quot;À Vista&quot; define a taxa de juros como 0% e desativa renovações mensais. Se este contrato possui juros ou renovação, selecione <strong>&quot;À Vista + Juros&quot;</strong>.
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Categoria</label>
                <div className="flex flex-wrap gap-2.5">
                  {["Sem categoria", "Educação", "Emergência", "Família", "Pessoal", "Trabalho"].map((cat) => (
                    <button key={cat} type="button" onClick={() => setCategoria(cat)} className={`py-2 px-4 rounded-full border text-sm font-bold transition-all cursor-pointer ${categoria === cat ? "bg-blue-600 text-white border-blue-600 shadow-sm scale-[1.05]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{cat}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Secao 3: Datas */}
        <div className="bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500" />
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-amber-50 rounded-xl"><Calendar className="w-5 h-5 text-amber-600" /></div>
              <div><h2 className="text-base font-black text-slate-800 tracking-tight">Datas e Detalhes</h2><p className="text-sm text-slate-500 mt-0.5">Determine os juros e prazos.</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {tipoPagamento !== "a_vista" && (
                <div className="space-y-2 animate-in fade-in duration-200">
                  <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Taxa de Juros (%)</label>
                  <div className="relative">
                    <input type="number" name="taxaJuros" min="0" step="any" value={taxaJuros} onChange={(e) => setTaxaJuros(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors" />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">%</span>
                  </div>
                </div>
              )}
              {tipoPagamento === "a_vista" && <input type="hidden" name="taxaJuros" value="0" />}
              {tipoPagamento !== "a_vista" && tipoPagamento !== "a_vista_juros" && (
                <div className="space-y-2 animate-in fade-in duration-200">
                  <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Nº de Parcelas</label>
                  <input type="number" min="1" max="120" value={periodos} onChange={(e) => setPeriodos(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors" />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">Data de Início <span className="text-rose-500">*</span></label>
                <input type="date" name="dataInicio" required value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer" />
              </div>
              <div className="space-y-2 animate-in fade-in duration-200">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">
                  {tipoPagamento === "a_vista" || tipoPagamento === "a_vista_juros" || tipoPagamento === "juros_compostos"
                    ? "Data de Vencimento"
                    : "Vencimento 1ª Parcela"}
                </label>
                <input type="date" value={vencimentoPrimeira} onChange={(e) => setVencimentoPrimeira(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer" />
              </div>
            </div>
            <div className="mt-8 space-y-3 pt-6 border-t border-slate-100">
              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Frequência de Cobrança</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[{ id: "diario", label: "Diário" }, { id: "semanal", label: "Semanal" }, { id: "quinzenal", label: "Quinzenal" }, { id: "mensal", label: "Mensal" }].map((freq) => (
                  <button key={freq.id} type="button" onClick={() => setFrequencia(freq.id as Frequencia)} className={`py-2.5 px-2 rounded-xl border text-sm font-bold transition-all text-center cursor-pointer ${frequencia === freq.id ? "bg-amber-500 text-white border-amber-500 shadow-md" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>{freq.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* Secao 4: Opcoes Avancadas */}
        <div className="bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-slate-400" />
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-slate-100 rounded-xl"><Settings className="w-5 h-5 text-slate-600" /></div>
              <div><h2 className="text-base font-black text-slate-800 tracking-tight">Opções Avançadas</h2><p className="text-sm text-slate-500 mt-0.5">Juros de atraso, parcelas e anotações.</p></div>
            </div>
            <div className="space-y-6">
              <AtrasoField tipoInicial={emprestimo.atraso_tipo} valorInicial={emprestimo.atraso_valor} />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-rose-50 rounded-xl border border-rose-200">
                <div className="mb-4 sm:mb-0">
                  <span className="block text-sm font-bold text-rose-800">Recriar parcelas em aberto</span>
                  <span className="text-sm text-rose-600 mt-1 block">Apaga as {parcelasAbertas.length} abertas e gera novas com os valores acima.{parcelasPagas.length > 0 && ` As ${parcelasPagas.length} pagas são mantidas.`}</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" checked={recriarParcelas} onChange={(e) => setRecriarParcelas(e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-500" />
                </label>
              </div>
              <div className="space-y-2 pt-2">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Observações</label>
                <div className="relative">
                  <div className="absolute left-4 top-4 text-slate-400"><FileText className="w-4 h-4" /></div>
                  <textarea name="observacoes" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Notas sobre o empréstimo..." className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium hover:border-emerald-400 transition-colors resize-y" />
                </div>
              </div>
            </div>
          </div>
        </div>
        {recriarParcelas && parcelasSimuladas.length > 0 && (
          <div className="bg-white border border-slate-200 shadow-lg rounded-2xl relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500" />
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-sm font-black text-slate-900 tracking-tight">Novas Parcelas Simuladas</h3>
              <p className="text-sm text-slate-500 mt-1">Substituirão as {parcelasAbertas.length} em aberto.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-400 uppercase font-black tracking-widest border-b border-slate-100 bg-slate-50/80">
                  <tr><th className="py-3 px-6 w-24 text-center">Nº</th><th className="py-3 px-6">Vencimento</th><th className="py-3 px-6 text-right">Valor</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parcelasSimuladas.map((p) => (
                    <tr key={p.numero} className="hover:bg-emerald-50/50 transition-colors">
                      <td className="py-3.5 px-6 font-black text-slate-800 text-center">{p.numero}</td>
                      <td className="py-3.5 px-6 font-semibold text-slate-600">{formatDataBr(p.data_vencimento)}</td>
                      <td className="py-3.5 px-6 text-right font-black text-emerald-600">{formatBRL(p.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-6 bg-emerald-50 border-t border-emerald-100">
              <span className="text-sm font-black text-emerald-800 uppercase tracking-widest">Total Simulado</span>
              <span className="text-base font-black text-emerald-700">{formatBRL(parcelasSimuladas.reduce((acc, p) => acc + p.valor, 0))}</span>
            </div>
          </div>
        )}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-6 mt-8 border-t border-slate-200">
          <Link href={`/emprestimos/${emprestimo.id}`} className="w-full sm:w-auto text-center px-6 py-3.5 bg-white text-slate-600 border border-slate-200 rounded-xl text-sm font-black tracking-wide hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm">Cancelar</Link>
          <button type="submit" disabled={isPending} className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-emerald-600 text-white px-8 py-3.5 rounded-xl text-sm font-black tracking-wide hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-500/20 transition-all disabled:opacity-50 shadow-md transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer">
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            <span>{isPending ? "Salvando..." : "Salvar Alterações"}</span>
          </button>
        </div>
      </form>
      {showOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm motion-modal-backdrop-in">
          <div className="bg-white p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl border border-slate-200 flex flex-col items-center justify-center space-y-6 text-center motion-modal-card-in">
            <div className="relative flex items-center justify-center w-28 h-28 bg-emerald-50 rounded-full overflow-hidden transition-transform duration-300">
              {overlayStep === 2 ? <div className="w-full h-full flex items-center justify-center animate-in zoom-in-90 duration-200"><CheckCircle2 className="w-16 h-16 text-emerald-500 drop-shadow-md" /></div> : <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />}
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-black text-slate-800 tracking-tight">{overlayStep === 0 && "Validando dados..."}{overlayStep === 1 && "Atualizando empréstimo..."}{overlayStep === 2 && "Alterações salvas!"}</h3>
              <p className="text-sm font-medium text-slate-500">{overlayStep === 0 && "Verificando informações."}{overlayStep === 1 && (recriarParcelas ? "Recalculando parcelas." : "Atualizando dados.")}{overlayStep === 2 && "Tudo pronto! Redirecionando..."}</p>
            </div>
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all duration-300 ease-in-out" style={{ width: overlayStep === 0 ? "33%" : overlayStep === 1 ? "66%" : "100%" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
