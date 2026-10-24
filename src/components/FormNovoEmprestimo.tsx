"use client";

import { createEmprestimo } from "@/app/emprestimos/novo/actions";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Calendar, User, Wallet, Settings, FileText, CheckCircle2, ChevronRight, Calculator, MessageSquare, X } from "lucide-react";
import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import SearchableSelect from "@/components/SearchableSelect";
import AtrasoField from "@/components/AtrasoField";

interface Cliente {
  id: string;
  nome: string;
  telefone: string;
}

interface Parceiro {
  id: string;
  nome: string;
}

interface FormNovoEmprestimoProps {
  clientes: Cliente[];
  parceiros: Parceiro[];
  clienteIdParam?: string;
}

type TipoPagamento = 
  | "a_vista" 
  | "a_vista_juros" 
  | "juros_compostos" 
  | "parcelado" 
  | "juros_mensais" 
  | "parcela_juros_mes";

type Frequencia = "diario" | "semanal" | "quinzenal" | "mensal";

// Evita que 31/05 + 1 mês pule para Julho 01, travando no último dia do mês esperado (30/06).
const addMonthsCapped = (date: Date, months: number) => {
  const d = new Date(date.valueOf());
  const expectedMonth = (d.getMonth() + months) % 12;
  d.setMonth(d.getMonth() + months);
  if (d.getMonth() !== (expectedMonth < 0 ? expectedMonth + 12 : expectedMonth)) {
    d.setDate(0);
  }
  return d;
};

export default function FormNovoEmprestimo({ clientes, parceiros, clienteIdParam }: FormNovoEmprestimoProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Overlay Animado States
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayStep, setOverlayStep] = useState(0);

  // Inputs Comuns
  const [clienteId, setClienteId] = useState(clienteIdParam || "");
  const [parceiroId, setParceiroId] = useState("");
  const [valor, setValor] = useState<number>(0);
  const [tipoPagamento, setTipoPagamento] = useState<TipoPagamento>("a_vista_juros");
  const [frequencia, setFrequencia] = useState<Frequencia>("mensal");
  const [taxaJuros, setTaxaJuros] = useState<number>(30); // default 30%
  const [periodos, setPeriodos] = useState<number>(3); // parcelas ou meses
  const [dataInicio, setDataInicio] = useState("");
  const [vencimentoPrimeira, setVencimentoPrimeira] = useState("");
  const [categoria, setCategoria] = useState("Sem categoria");
  const [observacoes, setObservacoes] = useState("");
  const [enviarPdfWhatsapp, setEnviarPdfWhatsapp] = useState(true);
  const [vencimentoManual, setVencimentoManual] = useState(false);
  const [vencimentoManualData, setVencimentoManualData] = useState("");
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);
  const [showConfirmWaModal, setShowConfirmWaModal] = useState(false);

  // Inicializar datas padrão
  useEffect(() => {
    const hoje = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    setDataInicio(`${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`);

    const umMesDepois = addMonthsCapped(new Date(), 1);
    setVencimentoPrimeira(`${umMesDepois.getFullYear()}-${pad(umMesDepois.getMonth() + 1)}-${pad(umMesDepois.getDate())}`);
  }, []);

  // Recalcular Vencimento Primeira Parcela quando muda dataInicio ou frequencia
  useEffect(() => {
    if (!dataInicio) return;
    const [year, month, day] = dataInicio.split("-").map(Number);
    let start = new Date(year, month - 1, day, 12, 0, 0); // meio-dia para evitar fuso
    if (frequencia === "diario") start.setDate(start.getDate() + 1);
    else if (frequencia === "semanal") start.setDate(start.getDate() + 7);
    else if (frequencia === "quinzenal") start.setDate(start.getDate() + 15);
    else if (frequencia === "mensal") start = addMonthsCapped(start, 1);
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    setVencimentoPrimeira(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
  }, [dataInicio, frequencia]);

  // Função utilitária para adicionar períodos
  const addPeriod = (dateStr: string, index: number) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    let d = new Date(year, month - 1, day, 12, 0, 0); // meio-dia para evitar fuso
    if (frequencia === "diario") {
      d.setDate(d.getDate() + index);
    } else if (frequencia === "semanal") {
      d.setDate(d.getDate() + index * 7);
    } else if (frequencia === "quinzenal") {
      d.setDate(d.getDate() + index * 15);
    } else if (frequencia === "mensal") {
      d = addMonthsCapped(d, index);
    }
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // Gerar lista de parcelas simuladas
  const gerarParcelas = () => {
    if (valor <= 0 || !dataInicio) return [];
    const list: { numero: number; valor: number; data_vencimento: string }[] = [];

    if (tipoPagamento === "a_vista") {
      const venc = addPeriod(dataInicio, 1);
      list.push({ numero: 1, valor, data_vencimento: venc });
    } 
    else if (tipoPagamento === "a_vista_juros") {
      const venc = addPeriod(dataInicio, 1);
      const total = valor * (1 + taxaJuros / 100);
      list.push({ numero: 1, valor: Number(total.toFixed(2)), data_vencimento: venc });
    } 
    else if (tipoPagamento === "juros_compostos") {
      const venc = addPeriod(dataInicio, periodos);
      const total = valor * Math.pow(1 + taxaJuros / 100, periodos);
      list.push({ numero: 1, valor: Number(total.toFixed(2)), data_vencimento: venc });
    } 
    else if (tipoPagamento === "parcelado") {
      const total = valor * (1 + taxaJuros / 100);
      const valorParcela = Number((total / periodos).toFixed(2));
      for (let i = 0; i < periodos; i++) {
        list.push({
          numero: i + 1,
          valor: valorParcela,
          data_vencimento: addPeriod(vencimentoPrimeira, i),
        });
      }
    } 
    else if (tipoPagamento === "juros_mensais") {
      const valorJuros = Number((valor * (taxaJuros / 100)).toFixed(2));
      for (let i = 0; i < periodos; i++) {
        const isLast = i === periodos - 1;
        list.push({
          numero: i + 1,
          valor: isLast ? Number((valor + valorJuros).toFixed(2)) : valorJuros,
          data_vencimento: addPeriod(vencimentoPrimeira, i),
        });
      }
    } 
    else if (tipoPagamento === "parcela_juros_mes") {
      const valorParcela = Number(((valor / periodos) + (valor * (taxaJuros / 100))).toFixed(2));
      for (let i = 0; i < periodos; i++) {
        list.push({
          numero: i + 1,
          valor: valorParcela,
          data_vencimento: addPeriod(vencimentoPrimeira, i),
        });
      }
    }

    return list;
  };

  const parcelasSimuladas = gerarParcelas();

  // Obter data final de vencimento do empréstimo
  // Se modo manual está ativo e tem data informada, usa ela
  const dataVencimentoCalculada = parcelasSimuladas.length > 0
    ? parcelasSimuladas[parcelasSimuladas.length - 1].data_vencimento
    : vencimentoPrimeira;
  const dataVencimentoFinal = vencimentoManual && vencimentoManualData
    ? vencimentoManualData
    : dataVencimentoCalculada;

  // Para tipos à vista com data manual, substitui o vencimento das parcelas simuladas
  const parcelasFinais = parcelasSimuladas.map((p, idx) =>
    vencimentoManual && vencimentoManualData && parcelasSimuladas.length === 1
      ? { ...p, data_vencimento: vencimentoManualData }
      : p
  );

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  const formatDataBr = (dateStr: string) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  };

  const getDescricaoTipo = () => {
    switch (tipoPagamento) {
      case "a_vista":
        return "Pagamento único na data de vencimento. Ex: emprestou R$ 500 → recebe R$ 500. Sem juros e sem parcelas.";
      case "a_vista_juros":
        return "Pagamento único com juros simples. Ex: R$ 500 a 10% → recebe R$ 550 no vencimento. Quando usar: quer cobrar juros só no final.";
      case "juros_compostos":
        return "Juros compostos por período. Ex: R$ 200.000 a 10% por 3 meses → R$ 266.200 no vencimento. Quando usar: juros capitalizados a cada período.";
      case "parcelado":
        return "Parcelado em parcelas iguais (juros opcional). Ex: R$ 600 em 3x mensais. Quando usar: deseja receber em parcelas fixas.";
      case "juros_mensais":
        return "Juros por período + principal no final. Ex: R$ 200 a 10% → R$ 20 no 1º e 2º mês; no 3º mês R$ 220. Quando usar: quer receber juros mensais e o principal no final.";
      case "parcela_juros_mes":
        return "Parcela mensal com juros por mês embutido em todas as parcelas. Ex: R$ 1.000 a 10% por 10 meses → 10x de R$ 200. Quando usar: quer receber principal + juros todo mês.";
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!clienteId) {
      alert("Selecione uma pessoa (cliente) para o empréstimo.");
      return;
    }
    const formData = new FormData(e.currentTarget);
    formData.set("tipoPagamento", tipoPagamento);
    formData.set("frequencia", frequencia);
    formData.set("categoria", categoria);
    formData.set("dataVencimento", dataVencimentoFinal);
    formData.set("parcelasJson", JSON.stringify(parcelasFinais));

    setPendingFormData(formData);
    setShowConfirmWaModal(true);
  };

  const executarCriacao = (avisarNoWhats: boolean) => {
    if (!pendingFormData) return;
    const formData = pendingFormData;
    formData.set("enviarPdfWhatsapp", String(avisarNoWhats));
    setEnviarPdfWhatsapp(avisarNoWhats);
    setShowConfirmWaModal(false);

    setShowOverlay(true);
    setOverlayStep(1); // Processando e calculando parcelas

    startTransition(async () => {
      try {
        const res = await createEmprestimo(formData);
        if (res && res.success && res.redirectUrl) {
          setOverlayStep(2); // Sucesso
          // Envio do PDF via WhatsApp — feito no cliente (jspdf não funciona no servidor)
          if (avisarNoWhats && res.clienteTelefone) {
            setOverlayStep(3);
            try {
              const { obterCronogramaPdfBase64 } = await import("@/lib/cronogramaPdf");
              const pdfBase64 = obterCronogramaPdfBase64({
                clienteNome: res.clienteNome,
                tipoPagamento: res.tipoPagamento,
                valorEmprestado: res.valorEmprestado,
                taxaJuros: res.taxaJuros,
                taxaMulta: res.taxaMulta,
                atrasoTipo: res.atrasoTipo,
                atrasoValor: res.atrasoValor,
                observacoes: res.observacoes,
                parcelas: res.parcelas.map((p: any) => ({
                  numero: p.numero,
                  valor: p.valor,
                  data_vencimento: p.data_vencimento,
                  status: "aberto",
                })),
              });
              const fileName = `cronograma-${res.clienteNome.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`;
              const envio = await fetch("/api/whatsapp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messages: [{
                    phone: res.clienteTelefone,
                    document: pdfBase64,
                    mimetype: "application/pdf",
                    fileName,
                    caption: res.legendaPdf || "Contratação realizada com sucesso!",
                  }],
                }),
              });
              if (!envio.ok) {
                const d = await envio.json().catch(() => ({}));
                alert(`Empréstimo criado, mas o PDF não foi enviado: ${d.error || "verifique se o WhatsApp está conectado."}`);
              }
            } catch (pdfErr) {
              console.error("Erro ao enviar PDF via WhatsApp:", pdfErr);
              // Não bloqueia o redirect — PDF é opcional
            }
          }
          router.push(res.redirectUrl);
        } else {
          alert("Erro ao criar empréstimo.");
          setShowOverlay(false);
        }
      } catch (err) {
        console.error("Erro ao salvar empréstimo:", err);
        alert("Erro ao salvar empréstimo.");
        setShowOverlay(false);
      }
    });
  };

  return (
    <div className="w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl mx-auto space-y-6">
      {/* Voltar */}
      <Link
        href="/emprestimos"
        className="flex items-center space-x-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Voltar para Empréstimos</span>
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Novo empréstimo</h1>
        <p className="text-slate-500">Configure os parâmetros do novo empréstimo em dinheiro.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 pb-20">
        {/* Seção 1: Cliente */}
        <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative transition-shadow hover:shadow-lg z-10">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500 rounded-l-2xl"></div>
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-emerald-50 rounded-xl">
                <User className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-800 tracking-tight">Dados do Cliente</h2>
                <p className="text-sm text-slate-500 mt-0.5">Vincule o empréstimo a uma pessoa e parceiro.</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label htmlFor="clienteId" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  Pessoa <span className="text-rose-500">*</span>
                </label>
                <div className="bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-emerald-500 hover:border-emerald-400 transition-colors">
                  <SearchableSelect
                    name="clienteId"
                    value={clienteId}
                    onChange={setClienteId}
                    options={clientes}
                    placeholder="Selecione uma pessoa..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="parceiroId" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  Quem Emprestou? <span className="text-rose-500">*</span>
                </label>
                <select
                  id="parceiroId"
                  name="parceiroId"
                  value={parceiroId}
                  onChange={(e) => setParceiroId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium hover:border-emerald-400 transition-colors cursor-pointer"
                >
                  <option value="">Eu (Administrador)</option>
                  {parceiros.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} (Parceiro)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Seção 2: Valores e Modalidade */}
        <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg mt-6">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-500"></div>
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-blue-50 rounded-xl">
                <Wallet className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-800 tracking-tight">Valores e Modalidade</h2>
                <p className="text-sm text-slate-500 mt-0.5">Defina o montante e a forma como será pago.</p>
              </div>
            </div>

            <div className="space-y-8">
              <div className="space-y-3">
                <label htmlFor="valorEmprestado" className="text-sm font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                  Valor Principal <span className="text-rose-500">*</span>
                </label>
                <div className="relative group max-w-sm">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <span className="text-sm font-black text-emerald-600">R$</span>
                  </div>
                  <input
                    type="number"
                    id="valorEmprestado"
                    name="valorEmprestado"
                    required
                    min="1"
                    step="any"
                    placeholder="0,00"
                    value={valor || ""}
                    onChange={(e) => setValor(Number(e.target.value))}
                    className="w-full bg-emerald-50/50 border-2 border-emerald-500/50 rounded-xl pl-10 pr-4 py-3.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 text-emerald-700 font-black transition-all shadow-sm placeholder:text-emerald-500/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  Tipo de Pagamento <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">
                  {[
                    { id: "a_vista", label: "À Vista" },
                    { id: "a_vista_juros", label: "À Vista + Juros" },
                    { id: "juros_compostos", label: "Juros Compostos" },
                    { id: "parcelado", label: "Parcelado" },
                    { id: "juros_mensais", label: "Juros Mensais" },
                    { id: "parcela_juros_mes", label: "Parcela + Juros/Mês" },
                  ].map((tipo) => (
                    <button
                      key={tipo.id}
                      type="button"
                      onClick={() => setTipoPagamento(tipo.id as TipoPagamento)}
                      className={`relative py-3.5 px-4 rounded-xl border text-sm font-bold transition-all text-center overflow-hidden flex items-center justify-center gap-2 cursor-pointer ${
                        tipoPagamento === tipo.id
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-md transform scale-[1.02]"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-emerald-400"
                      }`}
                    >
                      {tipoPagamento === tipo.id && <CheckCircle2 className="w-4 h-4 absolute left-3 opacity-50" />}
                      {tipo.label}
                    </button>
                  ))}
                </div>
                <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-100 flex items-start gap-3 mt-2">
                  <Calculator className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-800 font-medium leading-relaxed">
                    {getDescricaoTipo()}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  Categoria da Operação
                </label>
                <div className="flex flex-wrap gap-2.5">
                  {[
                    "Sem categoria",
                    "Educação",
                    "Emergência",
                    "Família",
                    "Pessoal",
                    "Trabalho",
                  ].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoria(cat)}
                      className={`py-2 px-4 rounded-full border text-sm font-bold transition-all cursor-pointer ${
                        categoria === cat
                          ? "bg-blue-600 text-white border-blue-600 shadow-sm transform scale-[1.05]"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Seção 3: Datas e Detalhes */}
        <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg mt-6">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-amber-50 rounded-xl">
                <Calendar className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-800 tracking-tight">Datas e Detalhes</h2>
                <p className="text-sm text-slate-500 mt-0.5">Determine os juros e os prazos.</p>
              </div>
            </div>

            {/* Vencimento — Automático ou Manual */}
            {(tipoPagamento === "a_vista" || tipoPagamento === "a_vista_juros" || tipoPagamento === "juros_compostos") && (
              <div className={`rounded-xl border text-sm mb-6 shadow-sm overflow-hidden ${vencimentoManual ? "border-slate-300 bg-white" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 py-3">
                  <span className={`font-bold ${vencimentoManual ? "text-slate-700" : "text-amber-800"}`}>
                    {vencimentoManual ? "Data de vencimento (manual)" : "Vencimento calculado automaticamente:"}
                  </span>
                  <div className="flex items-center gap-3">
                    {!vencimentoManual && (
                      <span className="font-black text-amber-600">{formatDataBr(dataVencimentoCalculada)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setVencimentoManual(!vencimentoManual);
                        if (!vencimentoManual) setVencimentoManualData(dataVencimentoCalculada);
                      }}
                      className={`text-xs font-black px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                        vencimentoManual
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white text-slate-600 border-slate-300 hover:border-amber-400"
                      }`}
                    >
                      {vencimentoManual ? "Automático" : "Editar data"}
                    </button>
                  </div>
                </div>
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                    vencimentoManual ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4">
                      <input
                        type="date"
                        required={vencimentoManual}
                        value={vencimentoManualData}
                        onChange={(e) => setVencimentoManualData(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Taxa de Juros */}
              {tipoPagamento !== "a_vista" && (
                <div className="space-y-2 col-span-1 animate-in fade-in duration-200">
                  <label htmlFor="taxaJuros" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    {tipoPagamento === "juros_compostos" || tipoPagamento === "juros_mensais" || tipoPagamento === "parcela_juros_mes"
                      ? "Taxa de Juros por Período (%) *"
                      : "Taxa de Juros (%) - Opcional"}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      id="taxaJuros"
                      name="taxaJuros"
                      required
                      min="0"
                      step="any"
                      value={taxaJuros}
                      onChange={(e) => setTaxaJuros(Number(e.target.value))}
                      placeholder="Ex: 5.5"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">%</span>
                  </div>
                </div>
              )}

              {/* Número de parcelas */}
              {tipoPagamento !== "a_vista" && tipoPagamento !== "a_vista_juros" && (
                <div className="space-y-2 col-span-1 animate-in fade-in duration-200">
                  <label htmlFor="periodos" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    {tipoPagamento === "juros_compostos"
                      ? "Número de Períodos *"
                      : tipoPagamento === "juros_mensais"
                      ? "Número de Meses *"
                      : "Número de Parcelas *"}
                  </label>
                  <input
                    type="number"
                    id="periodos"
                    required
                    min="1"
                    max="120"
                    value={periodos}
                    onChange={(e) => setPeriodos(Number(e.target.value))}
                    placeholder="Ex: 12"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors"
                  />
                </div>
              )}

              {/* Data de Início */}
              <div className="space-y-2">
                <label htmlFor="dataInicio" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  Data de Início <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  id="dataInicio"
                  name="dataInicio"
                  required
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer"
                />
              </div>

              {/* Vencimento 1ª Parcela */}
              {tipoPagamento !== "a_vista" && tipoPagamento !== "a_vista_juros" && tipoPagamento !== "juros_compostos" && (
                <div className="space-y-2 animate-in fade-in duration-200">
                  <label htmlFor="vencimentoPrimeira" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                    Vencimento da 1ª Parcela <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    id="vencimentoPrimeira"
                    required
                    value={vencimentoPrimeira}
                    onChange={(e) => setVencimentoPrimeira(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 font-semibold hover:border-amber-400 transition-colors cursor-pointer"
                  />
                </div>
              )}
            </div>

            <div className="mt-8 space-y-3 pt-6 border-t border-slate-100">
              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                Frequência de Cobrança <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { id: "diario", label: "Diário" },
                  { id: "semanal", label: "Semanal" },
                  { id: "quinzenal", label: "Quinzenal" },
                  { id: "mensal", label: "Mensal" },
                ].map((freq) => (
                  <button
                    key={freq.id}
                    type="button"
                    onClick={() => setFrequencia(freq.id as Frequencia)}
                    className={`py-2.5 px-2 rounded-xl border text-sm font-bold transition-all text-center cursor-pointer ${
                      frequencia === freq.id
                        ? "bg-amber-500 text-white border-amber-500 shadow-md"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-400"
                    }`}
                  >
                    {freq.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Seção 4: Configurações Avançadas */}
        <div className="premium-card bg-white border border-slate-200 shadow-md rounded-2xl relative overflow-hidden transition-shadow hover:shadow-lg mt-6">
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-slate-400"></div>
          <div className="p-6 md:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2.5 bg-slate-100 rounded-xl">
                <Settings className="w-5 h-5 text-slate-600" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-800 tracking-tight">Opções Avançadas</h2>
                <p className="text-sm text-slate-500 mt-0.5">Juros de atraso e anotações extras.</p>
              </div>
            </div>

            <div className="space-y-6">
              <AtrasoField />

              <div className="space-y-2 pt-2">
                <label htmlFor="observacoes" className="text-sm font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                  Observações
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-4 text-slate-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <textarea
                    id="observacoes"
                    name="observacoes"
                    rows={3}
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    placeholder="Notas sobre o empréstimo..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 font-medium hover:border-emerald-400 transition-colors resize-y"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabela de Simulação de Parcelas */}
        {parcelasFinais.length > 0 && (
          <div className="premium-card p-0 bg-white border border-slate-200 shadow-lg rounded-2xl relative overflow-hidden transition-all transform scale-[1.01] mt-10">
            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500"></div>
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div>
                <h3 className="text-sm font-black text-slate-900 tracking-tight">
                  Cronograma de Recebimentos Simulado
                </h3>
                <p className="text-sm text-slate-500 mt-1">Veja a projeção antes de confirmar.</p>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-slate-500">
                <thead className="text-xs text-slate-400 uppercase font-black tracking-widest border-b border-slate-100 bg-slate-50/80">
                  <tr>
                    <th className="py-3 px-6 w-24 text-center">Nº</th>
                    <th className="py-3 px-6">Vencimento</th>
                    <th className="py-3 px-6 text-right">Valor da Parcela</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parcelasFinais.map((p) => (
                    <tr key={p.numero} className="hover:bg-emerald-50/50 transition-colors group">
                      <td className="py-3.5 px-6 font-black text-slate-800 text-center">
                        {p.numero}
                      </td>
                      <td className="py-3.5 px-6 font-semibold flex items-center space-x-2 text-slate-600">
                        <Calendar className="w-4 h-4 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                        <span>{formatDataBr(p.data_vencimento)}</span>
                      </td>
                      <td className="py-3.5 px-6 text-right font-black text-emerald-600 text-sm">
                        {formatBRL(p.valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totalizador */}
            <div className="flex items-center justify-between p-6 bg-emerald-50 border-t border-emerald-100">
              <span className="text-sm font-black text-emerald-800 uppercase tracking-widest">
                Total Estimado
              </span>
              <span className="text-base font-black text-emerald-700">
                {formatBRL(parcelasFinais.reduce((acc, p) => acc + p.valor, 0))}
              </span>
            </div>
          </div>
        )}

        {/* Opção de Envio do Cronograma por WhatsApp */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start space-x-3.5">
              <div className={`p-2.5 rounded-xl transition-colors mt-0.5 shrink-0 ${enviarPdfWhatsapp ? "bg-emerald-50 text-emerald-600 border border-emerald-200" : "bg-slate-100 text-slate-400 border border-slate-200"}`}>
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-black text-slate-800">
                    Enviar Cronograma (PDF) via WhatsApp
                  </h4>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${enviarPdfWhatsapp ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                    {enviarPdfWhatsapp ? "Ativado" : "Desativado"}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-xl">
                  {enviarPdfWhatsapp
                    ? "O PDF oficial com a tabela de parcelas será gerado e enviado automaticamente para o WhatsApp do cliente logo após a criação."
                    : "Nenhum PDF será enviado agora. Você ainda poderá baixar ou gerar a qualquer momento dentro do empréstimo."}
                </p>
              </div>
            </div>

            {/* Toggle Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={enviarPdfWhatsapp}
              onClick={() => setEnviarPdfWhatsapp(!enviarPdfWhatsapp)}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/30 self-start sm:self-center ${
                enviarPdfWhatsapp ? "bg-emerald-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  enviarPdfWhatsapp ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Ações */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-6 mt-8 border-t border-slate-200">
          <Link
            href="/emprestimos"
            className="w-full sm:w-auto text-center px-6 py-3.5 bg-white text-slate-600 border border-slate-200 rounded-xl text-sm font-black tracking-wide hover:bg-slate-50 hover:text-slate-900 transition-all shadow-sm"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-emerald-600 text-white px-8 py-3.5 rounded-xl text-sm font-black tracking-wide hover:bg-emerald-700 hover:shadow-lg hover:shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:hover:shadow-none shadow-md transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
          >
            {isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
            <span>{isPending ? "Processando..." : "Criar Empréstimo"}</span>
          </button>
        </div>
      </form>

      {/* Modal de Confirmação: Avisar ou não no WhatsApp ao criar empréstimo */}
      {showConfirmWaModal && (() => {
        const cli = clientes.find((c) => c.id === clienteId);
        const totalSim = parcelasFinais.reduce((acc, p) => acc + p.valor, 0);
        return (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget && !isPending) setShowConfirmWaModal(false);
            }}
            className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm motion-modal-backdrop-in"
          >
            <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden motion-modal-card-in">
              <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-emerald-50/70">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
                    <MessageSquare className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-sm sm:text-base">
                      Deseja avisar o cliente no WhatsApp?
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {cli ? `Cliente: ${cli.nome}` : "Confirmação de novo empréstimo"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmWaModal(false)}
                  disabled={isPending}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-4">
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Valor Emprestado</span>
                    <span className="font-black text-slate-900">{formatBRL(valor)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Total Estimado</span>
                    <span className="font-black text-emerald-600">{formatBRL(totalSim)}</span>
                  </div>
                  <div className="flex justify-between pt-1.5 border-t border-slate-200/60">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Vencimento</span>
                    <span className="font-bold text-slate-800">{formatDataBr(dataVencimentoFinal)}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  Escolha se deseja enviar a confirmação e o cronograma em PDF para o WhatsApp de{" "}
                  <strong className="text-slate-900">{cli?.nome || "cliente"}</strong> agora:
                </p>

                <div className="flex flex-col gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => executarCriacao(true)}
                    disabled={isPending}
                    className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Sim, Criar e Avisar no WhatsApp</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => executarCriacao(false)}
                    disabled={isPending}
                    className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs sm:text-sm font-black rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4 text-slate-600" />
                    <span>Não, Criar sem Avisar no WhatsApp</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowConfirmWaModal(false)}
                    disabled={isPending}
                    className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-bold transition-colors cursor-pointer text-center"
                  >
                    Voltar e revisar dados
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Overlay Animado de Criação */}
      {showOverlay && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-opacity">
          <div className="bg-white p-8 rounded-3xl max-w-sm w-full mx-4 shadow-2xl border border-slate-200 flex flex-col items-center justify-center space-y-6 text-center transform animate-in zoom-in-95 duration-300">
            {/* Ícone dinâmico dependendo do step */}
            <div className="relative flex items-center justify-center w-28 h-28 bg-emerald-50 rounded-full overflow-hidden">
               {overlayStep === 2 || overlayStep === 3 ? (
                 <div className="w-full h-full flex items-center justify-center animate-in zoom-in duration-300">
                   <CheckCircle2 className="w-16 h-16 text-emerald-500 drop-shadow-md" />
                 </div>
               ) : (
                 <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
               )}
            </div>
            
            <div className="space-y-2">
              <h3 className="text-base font-black text-slate-800 tracking-tight">
                {overlayStep === 0 && "Validando dados..."}
                {overlayStep === 1 && "Calculando parcelas..."}
                {overlayStep === 2 && "Contratação realizada com sucesso!"}
                {overlayStep === 3 && "Enviando cronograma via WhatsApp..."}
              </h3>
              <p className="text-sm font-medium text-slate-500">
                {overlayStep === 0 && "Verificando informações do cliente e parceiro."}
                {overlayStep === 1 && "Projetando recebimentos e juros."}
                {overlayStep === 2 && "Salvando e preparando envio..."}
                {overlayStep === 3 && "O PDF já está sendo enviado para o cliente."}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-emerald-500 transition-all duration-700 ease-in-out"
                 style={{ width: overlayStep === 0 ? "25%" : overlayStep === 1 ? "50%" : overlayStep === 2 ? "75%" : "100%" }}
               />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
