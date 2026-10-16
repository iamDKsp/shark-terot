"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Trash2, Calendar, MessageSquare, AlertCircle,
  Clock, CheckCircle2, X, Loader2, Phone, TrendingUp,
  RefreshCw, CalendarClock, ShieldOff, Shield, Layers,
  BadgeCheck, AlertTriangle, ChevronRight, Wallet, DollarSign, Pencil,
  FileDown, Send, PauseCircle, PlayCircle
} from "lucide-react";
import {
  payNextInstallment, payFullLoan, renegociarEmprestimo,
  reprogramarEmprestimo, toggleClientBlacklist, deleteLoan,
  receberSoJurosEmprestimo, salvarDataPrevistaPagamento,
  atualizarDataPagamentoParcela, payInstallmentById,
  togglePausarEmprestimo
} from "@/app/emprestimos/[id]/actions";
import { enviarMensagemManual, legendaCronograma, listarRespostasRapidas } from "@/app/mensagens/actions";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import { calcularJurosAtraso, descreverRegraAtraso, regraAtiva } from "@/lib/jurosAtraso";
import { baixarCronogramaPdfCliente, obterCronogramaPdfBase64 } from "@/lib/cronogramaPdf";

interface Cliente { id: string; nome: string; telefone: string; blacklist: boolean; foto_url: string | null; }
interface Parcela { id: string; numero: number; valor: number; data_vencimento: any; status: string; data_pagamento: any; }
interface Parceiro { id: string; nome: string; }
interface Emprestimo {
  id: string; valor_emprestado: number; taxa_juros: number; taxa_multa: number;
  data_vencimento: any; status: string; tipo_pagamento: string; frequencia: string;
  categoria: string; observacoes: string | null; cliente: Cliente; parcelas: Parcela[]; parceiro?: Parceiro | null;
  data_prevista_pagamento: string | null;
  atraso_tipo?: string | null; atraso_valor?: number | null;
}

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-slate-400";

function Modal({ 
  onClose, 
  title, 
  subtitle, 
  maxWidth = "max-w-sm",
  isClosing = false,
  children 
}: { 
  onClose: () => void; 
  title: string; 
  subtitle?: string; 
  maxWidth?: string;
  isClosing?: boolean;
  children: React.ReactNode 
}) {
  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={`fixed inset-0 p-3 sm:p-4 z-50 flex items-center justify-center ${
        isClosing ? "motion-modal-backdrop-out" : "motion-modal-backdrop-in"
      }`}
    >
      <div className={`bg-white border border-slate-200 rounded-3xl w-full ${maxWidth} max-h-[calc(100dvh-2rem)] flex flex-col shadow-2xl overflow-hidden ${
        isClosing ? "motion-modal-card-out" : "motion-modal-card-in"
      }`}>
        <div className="flex items-start justify-between p-4 sm:p-6 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="min-w-0 pr-2">
            <h3 className="font-black text-sm sm:text-base text-slate-900 tracking-tight">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0 cursor-pointer shadow-sm active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export default function EmprestimoDetalhesView({ 
  emprestimo,
  perguntarWhatsappRenovacao = false,
  modoCarencia = false,
  modoCarencia10 = false,
}: { 
  emprestimo: Emprestimo;
  perguntarWhatsappRenovacao?: boolean;
  modoCarencia?: boolean;
  modoCarencia10?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal] = useState<null | "renegociar" | "reprogramar" | "delete" | "wa" | "renovar_juros">(null);
  const [modalClosing, setModalClosing] = useState(false);

  const closeModal = useCallback(() => {
    setModalClosing(true);
    setTimeout(() => {
      setModal(null);
      setModalClosing(false);
      setRenovFeedback(null);
    }, 150);
  }, []);

  const openModal = useCallback((type: "renegociar" | "reprogramar" | "delete" | "wa" | "renovar_juros") => {
    setModalClosing(false);
    setModal(type);
  }, []);

  const [renovEnviarWa, setRenovEnviarWa] = useState(true);
  const [renovFeedback, setRenovFeedback] = useState<{
    sucesso: boolean;
    erro?: string;
    whatsappEnviado?: boolean;
    whatsappErro?: string;
    whatsappTexto?: string;
  } | null>(null);

  // ── Data Prevista de Pagamento ──
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dataPrevistaInput, setDataPrevistaInput] = useState(
    emprestimo.data_prevista_pagamento ?? ""
  );
  const [isSavingData, setIsSavingData] = useState(false);

  const handleSalvarDataPrevista = async () => {
    if (!dataPrevistaInput) return;
    setIsSavingData(true);
    try {
      await salvarDataPrevistaPagamento(emprestimo.id, dataPrevistaInput);
      setShowDatePicker(false);
    } catch (err: any) {
      alert(err.message);
    }
    setIsSavingData(false);
  };

  const handleLimparDataPrevista = async () => {
    if (!confirm("Remover data prevista de pagamento?")) return;
    setIsSavingData(true);
    try {
      await salvarDataPrevistaPagamento(emprestimo.id, null);
      setDataPrevistaInput("");
      setShowDatePicker(false);
    } catch (err: any) {
      alert(err.message);
    }
    setIsSavingData(false);
  };

  // ── Editar Data do Pagamento da Parcela ──
  const [editingParcela, setEditingParcela] = useState<{ id: string; numero: number; data: string } | null>(null);
  const [editingParcelaClosing, setEditingParcelaClosing] = useState(false);

  const closeEditingParcela = useCallback(() => {
    setEditingParcelaClosing(true);
    setTimeout(() => {
      setEditingParcela(null);
      setEditingParcelaClosing(false);
    }, 150);
  }, []);

  const openEditingParcela = useCallback((p: { id: string; numero: number; data: string }) => {
    setEditingParcelaClosing(false);
    setEditingParcela(p);
  }, []);

  const [isSavingParcelaData, setIsSavingParcelaData] = useState(false);

  const [waTemplates, setWaTemplates] = useState<string[]>([]);
  const [waCustomMsg, setWaCustomMsg] = useState("");
  const [isWaSending, setIsWaSending] = useState(false);

  const [valorAbater, setValorAbater] = useState("");
  const [aplicarJuros, setAplicarJuros] = useState(false);
  const [taxaReneg, setTaxaReneg] = useState("10");

  const [novaData, setNovaData] = useState("");
  const [extra, setExtra] = useState("");
  const [taxaReprog, setTaxaReprog] = useState("");
  const [freqReprog, setFreqReprog] = useState(emprestimo.frequencia);

  useEffect(() => { if (modal === "reprogramar") setFreqReprog(emprestimo.frequencia); }, [modal]);

  useEffect(() => {
    listarRespostasRapidas().then(setWaTemplates).catch(() => {});
  }, []);

  const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
  const fmtDate = (d: any) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(d));
  const toInputDate = (d: any) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  };

  // ── Cálculos ──
  const totalEstimado = emprestimo.parcelas.length > 0
    ? emprestimo.parcelas.reduce((a, p) => a + p.valor, 0)
    : emprestimo.valor_emprestado * (1 + emprestimo.taxa_juros / 100);
  const totalPago = emprestimo.parcelas.reduce((a, p) => p.status.startsWith("pago") ? a + p.valor : a, 0);
  const saldoRestante = Math.max(0, totalEstimado - totalPago);
  const progresso = totalEstimado > 0 ? (totalPago / totalEstimado) * 100 : 0;

  const hojeUTC = hojeEmBrasilia();
  const vencObj = new Date(emprestimo.data_vencimento);
  const vencUTC = new Date(Date.UTC(vencObj.getUTCFullYear(), vencObj.getUTCMonth(), vencObj.getUTCDate()));
  const diasDiff = Math.ceil((vencUTC.getTime() - hojeUTC.getTime()) / 86400000);

  const abertas = emprestimo.parcelas.filter(p => p.status === "aberto");
  const pagas = emprestimo.parcelas.filter(p => p.status.startsWith("pago"));
  const multiplas = abertas.length > 1;

  const isExplicitRenovacao = (p: any) =>
    p.status === "pago_renovacao" || p.status.includes("renovacao") || p.status === "renovado";

  const valorJurosCalculado = Number(emprestimo.valor_emprestado) * (Number(emprestimo.taxa_juros) / 100);

  // Conta quantas parcelas são de principal (não-renovação)
  const parcelasNaoRenovacao = emprestimo.parcelas.filter(p => !isExplicitRenovacao(p));

  // Empréstimo é considerado À VISTA se:
  // 1. tipo_pagamento for 'a_vista', 'a_vista_juros' ou 'juros_compostos'
  // 2. OU se tiver apenas 1 parcela principal (não-renovação) no total!
  const isAVista =
    emprestimo.tipo_pagamento === "a_vista" ||
    emprestimo.tipo_pagamento === "a_vista_juros" ||
    emprestimo.tipo_pagamento === "juros_compostos" ||
    parcelasNaoRenovacao.length <= 1;

  // Classificação de itens: Renovação, À Vista ou Parcela normal
  let countRenovacao = 0;
  let countParcela = 0;
  const itensComLabels = emprestimo.parcelas.map((p, idx) => {
    const isRenovExp = isExplicitRenovacao(p);
    const isAVistaRenovacao = isAVista && emprestimo.parcelas.length > 1 && (idx < emprestimo.parcelas.length - 1 || isRenovExp);
    const isParceladoRenovacao = !isAVista && (isRenovExp || (Math.abs(p.valor - valorJurosCalculado) < 0.05 && p.status.startsWith("pago") && emprestimo.parcelas.length > 1));
    const isRenov = isRenovExp || isAVistaRenovacao || isParceladoRenovacao;

    if (isRenov) {
      countRenovacao++;
      return {
        ...p,
        label: `Renovação ${countRenovacao}`,
        tipoItem: "renovacao" as const,
      };
    } else if (isAVista) {
      return {
        ...p,
        label: "À Vista",
        tipoItem: "a_vista" as const,
      };
    } else {
      countParcela++;
      return {
        ...p,
        label: `Parcela ${p.numero || countParcela}`,
        tipoItem: "parcela" as const,
      };
    }
  });

  const proximaParcelaAberta = itensComLabels.find(p => p.status === "aberto");

  const totalRenovacoes = countRenovacao;
  const totalParcelasNormais = countParcela;

  const todasPagas = emprestimo.parcelas.length > 0 && emprestimo.parcelas.every(p => p.status.startsWith("pago"));
  const jurosRenovacoesPagas = itensComLabels
    .filter(p => p.tipoItem === "renovacao" && p.status.startsWith("pago"))
    .reduce((acc, p) => acc + p.valor, 0);
  const lucroJurosTotal = todasPagas
    ? Math.max(0, totalPago - Number(emprestimo.valor_emprestado))
    : jurosRenovacoesPagas;
  const valorQuitacao = proximaParcelaAberta ? proximaParcelaAberta.valor : 0;
  let statusReal = todasPagas ? "quitado" : emprestimo.status;
  let atrasado = false, venceHoje = false;
  let maxAtrasoDias = 0;

  if (!todasPagas) {
    emprestimo.parcelas.forEach((p) => {
      if (p.status !== "aberto") return;
      const v = new Date(p.data_vencimento);
      const vUTC = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
      if (vUTC < hojeUTC) {
        const diff = Math.floor((hojeUTC.getTime() - vUTC.getTime()) / (1000 * 3600 * 24));
        if (diff > maxAtrasoDias) maxAtrasoDias = diff;
      }
    });
    if (emprestimo.parcelas.length === 0 && vencUTC < hojeUTC) {
      maxAtrasoDias = Math.floor((hojeUTC.getTime() - vencUTC.getTime()) / (1000 * 3600 * 24));
    }

    const temVencido = maxAtrasoDias > 0;
    atrasado = modoCarencia10
      ? maxAtrasoDias > 10
      : modoCarencia
        ? maxAtrasoDias > 30
        : temVencido;
    const emCarencia = modoCarencia10
      ? (maxAtrasoDias > 2 && maxAtrasoDias <= 10)
      : (modoCarencia && maxAtrasoDias > 0 && maxAtrasoDias <= 30);

    venceHoje = emprestimo.parcelas.some((p) => {
      if (p.status !== "aberto") return false;
      const v = new Date(p.data_vencimento);
      return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).getTime() === hojeUTC.getTime();
    });
    if (emprestimo.parcelas.length === 0) {
      venceHoje = vencUTC.getTime() === hojeUTC.getTime();
    }
    if (modoCarencia10 && maxAtrasoDias >= 1 && maxAtrasoDias <= 2) {
      venceHoje = true;
    }
    if (atrasado) statusReal = "atrasado";
    else if (emCarencia) statusReal = "carencia";
  }

  const isPausado = emprestimo.status === "pausado";

  const STATUS = {
    quitado:  { label: "Quitado",        icon: <CheckCircle2 className="w-3 h-3" />, bg: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", stripe: "from-emerald-500/5 to-transparent" },
    atrasado: { label: (modoCarencia || modoCarencia10) ? `Atrasado (+${maxAtrasoDias}d)` : "Atrasado", icon: <AlertCircle className="w-3 h-3" />, bg: "bg-rose-50 text-rose-700 border-rose-200", bar: "bg-rose-500", stripe: "from-rose-500/5 to-transparent" },
    carencia: { label: `Em Carência (+${maxAtrasoDias}d)`, icon: <Clock className="w-3 h-3" />, bg: "bg-amber-50 text-amber-800 border-amber-200", bar: "bg-amber-500", stripe: "from-amber-500/5 to-transparent" },
    hoje:     { label: (modoCarencia10 && maxAtrasoDias > 0) ? `Hoje (+${maxAtrasoDias}d)` : "Vence Hoje", icon: <Clock className="w-3 h-3" />, bg: "bg-amber-50 text-amber-700 border-amber-200", bar: "bg-amber-500", stripe: "from-amber-500/5 to-transparent" },
    emDia:    { label: "Em Dia",          icon: <BadgeCheck className="w-3 h-3" />, bg: "bg-blue-50 text-blue-700 border-blue-200", bar: "bg-emerald-500", stripe: "from-blue-500/5 to-transparent" },
    pausado:  { label: "Pausado",         icon: <PauseCircle className="w-3 h-3" />, bg: "bg-yellow-50 text-yellow-700 border-yellow-200", bar: "bg-yellow-400", stripe: "from-yellow-500/5 to-transparent" },
  };
  const s = STATUS[isPausado ? "pausado" : statusReal === "quitado" ? "quitado" : statusReal === "carencia" ? "carencia" : atrasado ? "atrasado" : venceHoje ? "hoje" : "emDia"];


  const freqLabel: Record<string, string> = { diario: "Diário", semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal" };
  const tipoLabel: Record<string, string> = { a_vista: "À Vista", a_vista_juros: "À Vista + Juros", juros_compostos: "Juros Compostos", parcelado: "Parcelado", juros_mensais: "Juros Mensais" };

  // ── Handlers ──
  // ── Juros de atraso (por dia) ──
  const regraAtraso = { tipo: emprestimo.atraso_tipo, valor: emprestimo.atraso_valor };
  const jurosDe = (p: { valor: number; data_vencimento: any }) =>
    calcularJurosAtraso(regraAtraso, p.valor, p.data_vencimento, hojeUTC);

  /**
   * Pede a confirmação do recebimento. Se houver juros de atraso, mostra o total e deixa
   * o usuário escolher entre cobrar ou receber só o valor da parcela (perdoar o atraso).
   * O valor é recalculado no servidor; aqui só se decide cobrar ou não.
   */
  const confirmarRecebimento = (
    descricao: string,
    parcelas: { valor: number; data_vencimento: any }[]
  ): { ok: boolean; cobrar: boolean } => {
    const calcs = parcelas.map(jurosDe);
    const juros = calcs.reduce((a, x) => a + x.juros, 0);
    if (juros <= 0) return { ok: confirm(`Confirmar ${descricao}?`), cobrar: true };
    const base = parcelas.reduce((a, x) => a + x.valor, 0);
    const dias = Math.max(...calcs.map((x) => x.dias));
    const cobrar = confirm(
      `Confirmar ${descricao}?\n\n` +
      `Valor: ${fmt(base)}\n` +
      `Juros de atraso (${dias} dia${dias === 1 ? "" : "s"} · ${descreverRegraAtraso(regraAtraso)}): ${fmt(juros)}\n` +
      `Total a receber: ${fmt(base + juros)}\n\n` +
      `OK = cobrar com os juros de atraso\nCancelar = mais opções`
    );
    if (cobrar) return { ok: true, cobrar: true };
    return { ok: confirm(`Receber SEM cobrar os juros de atraso (${fmt(base)})?`), cobrar: false };
  };

  const pay = (withDelay: boolean) => {
    const acaoLabel = isAVista || !multiplas
      ? "QUITAÇÃO"
      : `recebimento da Parcela ${proximaParcelaAberta?.numero || ""}`;
    const dec = confirmarRecebimento(
      `${acaoLabel} como ${withDelay ? "atrasado" : "pago"}`,
      proximaParcelaAberta ? [proximaParcelaAberta] : []
    );
    if (!dec.ok) return;
    startTransition(async () => {
      try {
        const res = await payNextInstallment(emprestimo.id, withDelay, dec.cobrar);
        if (res?.whatsappEnviado) {
          alert(`Pagamento confirmado com sucesso!\nMensagem enviada para ${emprestimo.cliente.nome} no WhatsApp:\n\n"${res.whatsappTexto}"`);
        } else if (res?.whatsappErro) {
          alert(`Pagamento confirmado com sucesso!\n(Aviso: não foi possível enviar WhatsApp: ${res.whatsappErro})`);
        } else {
          alert("Pagamento confirmado com sucesso!");
        }
      } catch (err: any) {
        alert(err?.message || "Erro ao registrar pagamento.");
      }
    });
  };
  const payAll = (withDelay: boolean) => {
    const dec = confirmarRecebimento(
      `QUITAÇÃO TOTAL como ${withDelay ? "com atraso" : "pago"}`,
      emprestimo.parcelas.filter((x) => x.status === "aberto")
    );
    if (!dec.ok) return;
    startTransition(async () => {
      try {
        const res = await payFullLoan(emprestimo.id, withDelay, dec.cobrar);
        if (res?.whatsappEnviado) {
          alert(`Quitação confirmada com sucesso!\nMensagem enviada para ${emprestimo.cliente.nome} no WhatsApp:\n\n"${res.whatsappTexto}"`);
        } else if (res?.whatsappErro) {
          alert(`Quitação confirmada com sucesso!\n(Aviso: não foi possível enviar WhatsApp: ${res.whatsappErro})`);
        } else {
          alert("Quitação confirmada com sucesso!");
        }
      } catch (err: any) {
        alert(err?.message || "Erro ao registrar quitação.");
      }
    });
  };
  const paySpecific = (parcelaId: string, parcelaNumero: number, withDelay = false) => {
    const alvo = emprestimo.parcelas.find((x) => x.id === parcelaId);
    const dec = confirmarRecebimento(
      `recebimento da Parcela ${parcelaNumero} como ${withDelay ? "atrasada" : "paga"}`,
      alvo ? [alvo] : []
    );
    if (!dec.ok) return;
    startTransition(async () => {
      try {
        const res = await payInstallmentById(parcelaId, withDelay, dec.cobrar);
        if (res?.whatsappEnviado) {
          alert(`Pagamento da Parcela ${parcelaNumero} confirmado com sucesso!\nMensagem enviada para ${emprestimo.cliente.nome} no WhatsApp:\n\n"${res.whatsappTexto}"`);
        } else if (res?.whatsappErro) {
          alert(`Pagamento da Parcela ${parcelaNumero} confirmado com sucesso!\n(Aviso: não foi possível enviar WhatsApp: ${res.whatsappErro})`);
        } else {
          alert(`Pagamento da Parcela ${parcelaNumero} confirmado com sucesso!`);
        }
      } catch (err: any) {
        alert(err?.message || "Erro ao registrar pagamento.");
      }
    });
  };
  const toggleBL = () => {
    if (!confirm(emprestimo.cliente.blacklist ? "Remover da lista negra?" : "Marcar como LISTA NEGRA?")) return;
    startTransition(async () => { await toggleClientBlacklist(emprestimo.cliente.id, emprestimo.cliente.blacklist, emprestimo.id); });
  };
  const excluir = () => {
    startTransition(async () => {
      const res = await deleteLoan(emprestimo.id);
      if (res?.success && res?.redirectUrl) router.push(res.redirectUrl);
    });
  };

  const handlePausar = () => {
    const isPausado = emprestimo.status === "pausado";
    const msg = isPausado
      ? "Despausar este empréstimo? Ele voltará a aparecer em cobranças e no dashboard."
      : "Pausar este empréstimo? Foi feito um acordo com o cobrador. O empréstimo sairá das cobranças até ser despausado.";
    if (!confirm(msg)) return;
    startTransition(async () => {
      try {
        await togglePausarEmprestimo(emprestimo.id, emprestimo.status);
      } catch (err: any) {
        alert(err?.message || "Erro ao pausar empréstimo.");
      }
    });
  };


  const receiveJuros = () => {
    setRenovFeedback(null);
    setRenovEnviarWa(true);
    openModal("renovar_juros");
  };

  const executarRenovacao = (enviarWhatsapp: boolean) => {
    setRenovFeedback(null);
    startTransition(async () => {
      try {
        const res = await receberSoJurosEmprestimo(emprestimo.id, enviarWhatsapp);
        setRenovFeedback({
          sucesso: true,
          whatsappEnviado: res?.whatsappEnviado,
          whatsappErro: res?.whatsappErro,
          whatsappTexto: res?.whatsappTexto,
        });
      } catch (err: any) {
        setRenovFeedback({
          sucesso: false,
          erro: err?.message || "Erro ao renovar empréstimo.",
        });
      }
    });
  };

  const sendWaMsg = async (text: string) => {
    if (!text.trim()) return;
    setIsWaSending(true);
    try {
      const res = await enviarMensagemManual({
        clienteId: emprestimo.cliente.id,
        emprestimoId: emprestimo.id,
        texto: text,
      });
      if (res.ok) {
        alert("Mensagem enviada com sucesso!");
        closeModal();
        setWaCustomMsg("");
      } else {
        alert(`Erro ao enviar mensagem: ${res.erro || "tente novamente"}`);
      }
    } catch (err) {
      alert("Falha de conexão. Verifique se o serviço do WhatsApp está rodando.");
    }
    setIsWaSending(false);
  };

  const whatsapp = () => {
    openModal("wa");
  };

  const [isSendingPdfWa, setIsSendingPdfWa] = useState(false);

  const handleBaixarPdf = () => {
    try {
      baixarCronogramaPdfCliente({
        clienteNome: emprestimo.cliente.nome,
        clienteDocumento: (emprestimo.cliente as any).documento,
        tipoPagamento: emprestimo.tipo_pagamento,
        valorEmprestado: emprestimo.valor_emprestado,
        taxaJuros: emprestimo.taxa_juros,
        taxaMulta: emprestimo.taxa_multa,
        atrasoTipo: emprestimo.atraso_tipo,
        atrasoValor: emprestimo.atraso_valor,
        observacoes: emprestimo.observacoes,
        dataGeracao: new Date(),
        parcelas: emprestimo.parcelas.map((p) => ({
          numero: p.numero,
          data_vencimento: p.data_vencimento,
          valor: p.valor,
          status: p.status,
          data_pagamento: p.data_pagamento,
        })),
      });
    } catch (err: any) {
      console.error("Erro ao gerar PDF:", err);
      alert("Erro ao gerar PDF do cronograma.");
    }
  };

  const handleEnviarPdfWa = async () => {
    if (!confirm(`Enviar o cronograma em PDF diretamente para o WhatsApp de ${emprestimo.cliente.nome}?`)) return;
    setIsSendingPdfWa(true);
    try {
      const pdfBase64 = obterCronogramaPdfBase64({
        clienteNome: emprestimo.cliente.nome,
        clienteDocumento: (emprestimo.cliente as any).documento,
        tipoPagamento: emprestimo.tipo_pagamento,
        valorEmprestado: emprestimo.valor_emprestado,
        taxaJuros: emprestimo.taxa_juros,
        taxaMulta: emprestimo.taxa_multa,
        atrasoTipo: emprestimo.atraso_tipo,
        atrasoValor: emprestimo.atraso_valor,
        observacoes: emprestimo.observacoes,
        dataGeracao: new Date(),
        parcelas: emprestimo.parcelas.map((p) => ({
          numero: p.numero,
          data_vencimento: p.data_vencimento,
          valor: p.valor,
          status: p.status,
          data_pagamento: p.data_pagamento,
        })),
      });

      const fileName = `cronograma-${emprestimo.cliente.nome.toLowerCase().replace(/[^a-z0-9]/g, "-")}.pdf`;
      const legenda = await legendaCronograma(emprestimo.id);
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              phone: emprestimo.cliente.telefone,
              document: pdfBase64,
              mimetype: "application/pdf",
              fileName,
              caption: legenda,
            },
          ],
        }),
      });

      if (res.ok) {
        alert("Cronograma em PDF enviado com sucesso para o WhatsApp do cliente!");
      } else {
        const d = await res.json().catch(() => ({}));
        alert(`Não foi possível enviar: ${d.error || "Verifique se o WhatsApp está conectado."}`);
      }
    } catch (err: any) {
      alert("Falha de conexão com o servidor do WhatsApp.");
    } finally {
      setIsSendingPdfWa(false);
    }
  };
  const submitReneg = (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(valorAbater);
    if (!v || v <= 0) { alert("Valor inválido."); return; }
    startTransition(async () => {
      try { await renegociarEmprestimo(emprestimo.id, v, aplicarJuros, aplicarJuros ? Number(taxaReneg) : 0); setModal(null); setValorAbater(""); }
      catch (err: any) { alert(err.message); }
    });
  };
  const submitReprog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaData) { alert("Data obrigatória."); return; }
    startTransition(async () => {
      try { await reprogramarEmprestimo(emprestimo.id, novaData, extra ? Number(extra) : 0, taxaReprog ? Number(taxaReprog) : 0, freqReprog); setModal(null); setNovaData(""); setExtra(""); setTaxaReprog(""); }
      catch (err: any) { alert(err.message); }
    });
  };

  // ── Button helpers ──
  const BtnPrimary = ({ onClick, children, disabled }: any) => (
    <button onClick={onClick} disabled={disabled ?? isPending} className="flex items-center justify-center gap-1.5 w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white text-sm font-black tracking-wide rounded-xl transition-all shadow-sm shadow-emerald-500/20 disabled:opacity-60 cursor-pointer">
      {children}
    </button>
  );
  const BtnSecondary = ({ onClick, children, danger }: any) => (
    <button onClick={onClick} disabled={isPending} className={`flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-black tracking-wide rounded-xl border transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer ${danger ? "bg-slate-50 text-rose-600 border-slate-200 hover:bg-rose-50 hover:border-rose-300" : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"}`}>
      {children}
    </button>
  );

  const handleVoltar = () => {
    router.back();
  };

  return (
    <div className="w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto pb-12 space-y-4">

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-1">
        <button
          onClick={handleVoltar}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-sm font-semibold transition-colors group active:scale-95 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" /> Voltar
        </button>
        {isPending && <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            onClick={handleBaixarPdf}
            className="flex items-center gap-1.5 text-xs sm:text-sm font-black text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all shadow-sm cursor-pointer"
            title="Baixar Cronograma de Parcelas em PDF"
          >
            <FileDown className="w-3.5 h-3.5 text-emerald-600" /> <span className="hidden min-[380px]:inline">Baixar</span> PDF
          </button>
          <Link
            href={`/emprestimos/${emprestimo.id}/editar`}
            className="flex items-center gap-1.5 text-xs sm:text-sm font-black text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all"
          >
            <Pencil className="w-3.5 h-3.5" /> Editar
          </Link>
          <button onClick={() => openModal("delete")} className="flex items-center gap-1.5 text-xs sm:text-sm font-black text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 sm:px-3 py-1.5 rounded-xl transition-all cursor-pointer">
            <Trash2 className="w-3.5 h-3.5" /> Excluir
          </button>
        </div>
      </div>

      {/* Banner de aviso — Empréstimo Pausado */}
      {isPausado && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-2xl px-4 py-3">
          <PauseCircle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-black text-yellow-800">Empréstimo Pausado — Acordo com Cobrador</p>
            <p className="text-xs text-yellow-700 mt-0.5">Este empréstimo não aparece na tela de Cobranças nem no Dashboard. Use o botão &quot;Despausar&quot; para retomar.</p>
          </div>
        </div>
      )}

      {/* ── LAYOUT PRINCIPAL 2-col ── */}
      <div className="grid lg:grid-cols-3 gap-4">


        {/* COL ESQUERDA — 2/3 */}
        <div className="lg:col-span-2 space-y-4">

          {/* HERO CARD */}
          <div className={`relative overflow-hidden rounded-2xl border bg-white border-slate-200 shadow-sm`}>
            {/* Stripe lateral de status */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.bar}`} />
            <div className={`absolute inset-0 bg-gradient-to-r ${s.stripe} pointer-events-none`} />

            <div className="relative px-6 pt-5 pb-6">
              {/* Status + valor principal */}
              <div className="flex items-start justify-between mb-5">
                <span className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${s.bg}`}>
                  {s.icon} {s.label}
                </span>
                {statusReal !== "quitado" && (
                  <div className={`text-right text-xs font-black px-2.5 py-1 rounded-xl border ${
                    diasDiff < 0 ? "bg-rose-50 text-rose-700 border-rose-200" :
                    diasDiff === 0 ? "bg-amber-50 text-amber-700 border-amber-200" :
                    "bg-slate-50 text-slate-600 border-slate-200"
                  }`}>
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {fmtDate(emprestimo.data_vencimento)}
                    </div>
                    <div className="mt-0.5 opacity-80">
                      {diasDiff < 0 ? `${Math.abs(diasDiff)}d em atraso` : diasDiff === 0 ? "Vence hoje" : `${diasDiff}d restantes`}
                    </div>
                  </div>
                )}
              </div>

              {/* Valores */}
              <div className="flex flex-wrap gap-x-8 gap-y-3 mb-6">
                {isAVista ? (
                  <>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Valor Investido</p>
                      <p className="text-2xl font-black text-slate-900 leading-none tracking-tight">{fmt(emprestimo.valor_emprestado)}</p>
                    </div>
                    <div className="flex flex-wrap gap-6 items-end pb-1">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{todasPagas ? "Juros (Mês)" : "Juros"}</p>
                        <p className="text-sm font-black text-slate-700 leading-none">{fmt(valorJurosCalculado)}</p>
                      </div>
                      {todasPagas ? (
                        <>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Lucro em Juros</p>
                            <p className="text-sm font-black text-emerald-600 leading-none">{fmt(lucroJurosTotal)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Recebido</p>
                            <p className="text-sm font-black text-slate-900 leading-none">{fmt(totalPago)}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Quitação</p>
                            <p className="text-sm font-black text-slate-900 leading-none">{fmt(valorQuitacao > 0 ? valorQuitacao : (saldoRestante > 0 ? saldoRestante : totalEstimado))}</p>
                          </div>
                          {jurosRenovacoesPagas > 0 && (
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Juros Recebidos</p>
                              <p className="text-sm font-black text-emerald-600 leading-none">{fmt(jurosRenovacoesPagas)}</p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Saldo a Receber</p>
                      <p className="text-2xl font-black text-slate-900 leading-none tracking-tight">{fmt(saldoRestante > 0 ? saldoRestante : totalEstimado)}</p>
                    </div>
                    <div className="flex gap-6 items-end pb-1">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Juros</p>
                        <p className="text-sm font-black text-slate-500 leading-none">{fmt(totalEstimado - emprestimo.valor_emprestado)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Recebido</p>
                        <p className="text-sm font-black text-emerald-600 leading-none">{fmt(totalPago)}</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Barra de progresso */}
              <div>
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  <span>
                    {isAVista ? (
                      todasPagas
                        ? "Progresso — 100% quitado"
                        : totalRenovacoes > 0
                        ? `Status — ${totalRenovacoes} ${totalRenovacoes === 1 ? "renovação paga" : "renovações pagas"}`
                        : "Status — Empréstimo à Vista"
                    ) : (
                      `Progresso — ${progresso.toFixed(0)}% pago`
                    )}
                  </span>
                  <span>
                    {isAVista ? (
                      totalRenovacoes > 0 ? (
                        `${totalRenovacoes} ${totalRenovacoes === 1 ? "renovação" : "renovações"} · ${abertas.length > 0 ? "1 à vista" : "quitado"}`
                      ) : (
                        todasPagas ? "Quitado" : "À Vista"
                      )
                    ) : totalRenovacoes > 0 ? (
                      `${pagas.length - totalRenovacoes}/${totalParcelasNormais} parcelas · ${totalRenovacoes} ren.`
                    ) : (
                      `${pagas.length}/${emprestimo.parcelas.length} parcelas`
                    )}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${s.bar} transition-all duration-700`}
                    style={{
                      width: isAVista
                        ? "100%"
                        : `${Math.max(progresso, progresso > 0 ? 3 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* LISTA DE PAGAMENTOS / PARCELAS / RENOVAÇÕES */}
          {itensComLabels.length > 0 && (
            <div className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-black text-slate-900">
                    {isAVista ? (totalRenovacoes > 0 ? "Renovações e Quitação" : "Pagamento") : "Parcelas"}
                  </span>
                  <button
                    type="button"
                    onClick={handleBaixarPdf}
                    className="ml-2 inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                    title="Baixar Cronograma em PDF"
                  >
                    <FileDown className="w-3 h-3 text-emerald-600" /> PDF
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-black uppercase tracking-widest">
                  {totalRenovacoes > 0 && (
                    <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200">
                      {totalRenovacoes} {totalRenovacoes === 1 ? "renovação" : "renovações"}
                    </span>
                  )}
                  {isAVista ? (
                    abertas.length > 0 ? (
                      <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                        1 à vista
                      </span>
                    ) : (
                      <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                        Quitado
                      </span>
                    )
                  ) : (
                    <>
                      {pagas.length > 0 && (
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
                          {pagas.length - totalRenovacoes} pagas
                        </span>
                      )}
                      {abertas.length > 0 && (
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {abertas.length} abertas
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {itensComLabels.map((p) => {
                  const v = new Date(p.data_vencimento);
                  const pUTC = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
                  const pAtras = p.status === "aberto" && pUTC < hojeUTC;
                  const pHoje = p.status === "aberto" && pUTC.getTime() === hojeUTC.getTime();
                  const pPago = p.status.startsWith("pago");
                  const pAtrasoPago = p.status === "pago_com_atraso";
                  const isRenov = p.tipoItem === "renovacao";
                  const isAv = p.tipoItem === "a_vista";
                  const isMaisAtual = proximaParcelaAberta?.id === p.id;

                  return (
                    <div key={p.id} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition-colors ${pAtras ? "bg-rose-50/40" : isMaisAtual && !isAv ? "bg-emerald-50/20" : ""}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          isRenov ? "bg-purple-50 text-purple-600" :
                          pPago ? "bg-emerald-50 text-emerald-600" :
                          pAtras ? "bg-rose-50 text-rose-500" :
                          pHoje ? "bg-amber-50 text-amber-500" :
                          isMaisAtual && !isAv ? "bg-emerald-50 text-emerald-600" :
                          "bg-slate-100 text-slate-400"
                        }`}>
                          {isRenov ? (
                            <RefreshCw className="w-3.5 h-3.5" />
                          ) : pPago ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : pAtras ? (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          ) : pHoje ? (
                            <Clock className="w-3.5 h-3.5" />
                          ) : (
                            <Calendar className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                            <span className="text-sm font-black text-slate-900">{p.label}</span>
                            <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full border ${
                              isRenov ? "bg-purple-50 text-purple-700 border-purple-200" :
                              pPago ? (pAtrasoPago ? "bg-orange-50 text-orange-700 border-orange-200" : (isAv ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-emerald-50 text-emerald-700 border-emerald-200")) :
                              isMaisAtual && !isAv ? "bg-emerald-50 text-emerald-700 border-emerald-300 font-extrabold" :
                              pAtras ? "bg-rose-50 text-rose-700 border-rose-200" :
                              pHoje ? "bg-amber-50 text-amber-700 border-amber-200" :
                              "bg-slate-100 text-slate-500 border-slate-200"
                            }`}>
                              {isRenov
                                ? "renovado"
                                : pPago
                                ? (pAtrasoPago ? "c/ atraso" : (isAv ? "quitado" : "pago"))
                                : isMaisAtual && !isAv
                                ? (pAtras ? "atrasada (atual)" : pHoje ? "hoje (atual)" : "aberta (atual)")
                                : pAtras ? "atrasada" : pHoje ? "hoje" : "aberta"}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>Vence {fmtDate(p.data_vencimento)}</span>
                            {p.data_pagamento && (
                              <button
                                type="button"
                                onClick={() => openEditingParcela({ id: p.id, numero: p.numero, data: toInputDate(p.data_pagamento) })}
                                className="text-emerald-600 hover:text-emerald-700 font-bold inline-flex items-center gap-1 hover:underline cursor-pointer group"
                                title="Clique para editar a data de pagamento"
                              >
                                <span>· Pago {fmtDate(p.data_pagamento)}</span>
                                <Pencil className="w-3 h-3 text-emerald-500 opacity-60 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2.5 pt-2 sm:pt-0 border-t border-slate-100 sm:border-0">
                        <div className="text-left sm:text-right">
                          <span className="text-sm font-black text-slate-900">{fmt(p.valor)}</span>
                          {isAv && p.status === "aberto" && (
                            <span className="text-[10px] text-slate-400 block font-medium">
                              (Principal {fmt(emprestimo.valor_emprestado)} + Juros {fmt(valorJurosCalculado)})
                            </span>
                          )}
                        </div>
                        {p.status === "aberto" && (() => {
                          const a = jurosDe(p);
                          return a.juros > 0 ? (
                            <span
                              className="text-[11px] font-black text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5"
                              title={`Juros de atraso: ${descreverRegraAtraso(regraAtraso)} × ${a.dias} dia(s)`}
                            >
                              + {fmt(a.juros)} · {a.dias}d
                            </span>
                          ) : null;
                        })()}
                        {p.status === "aberto" && (
                          <div className="flex gap-1">
                            {isAVista ? (
                              <button
                                onClick={receiveJuros}
                                disabled={isPending}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-lg transition-colors shadow-sm cursor-pointer"
                              >
                                Renovação
                              </button>
                            ) : (
                              <button
                                onClick={() => paySpecific(p.id, p.numero)}
                                disabled={isPending}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-lg transition-colors shadow-sm cursor-pointer"
                              >
                                Pagar
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* COL DIREITA — 1/3 */}
        <div className="space-y-4">

          {/* CLIENTE */}
          <div className="rounded-2xl border bg-white border-slate-200 shadow-sm p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Tomador</p>
            <div className="flex items-center gap-3 mb-4">
              {emprestimo.cliente.foto_url ? (
                <img src={emprestimo.cliente.foto_url} alt={emprestimo.cliente.nome} className="w-11 h-11 rounded-xl object-cover border border-slate-200 shadow-sm" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white font-black text-sm shadow-sm flex-shrink-0">
                  {emprestimo.cliente.nome.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <Link href={`/clientes/${emprestimo.cliente.id}`} className="font-black text-sm text-slate-900 hover:text-emerald-600 transition-colors flex items-center gap-0.5 group truncate">
                  {emprestimo.cliente.nome}
                  <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </Link>
                <a href={`tel:${emprestimo.cliente.telefone}`} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" /> {emprestimo.cliente.telefone}
                </a>
              </div>
            </div>
            {emprestimo.cliente.blacklist && (
              <div className="flex items-center gap-1.5 text-xs font-black uppercase text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg">
                <ShieldOff className="w-3 h-3" /> Lista Negra
              </div>
            )}
          </div>

          {/* MÉTRICAS */}
          <div className="rounded-2xl border bg-white border-slate-200 shadow-sm p-5 grid grid-cols-2 gap-4">
            {[
              { label: "Principal", value: fmt(emprestimo.valor_emprestado), color: "text-slate-900" },
              { label: "Juros", value: `${emprestimo.taxa_juros}%`, color: "text-emerald-600" },
              {
                label: "Juros atraso",
                value: regraAtiva(regraAtraso)
                  ? descreverRegraAtraso(regraAtraso)
                  : emprestimo.taxa_multa > 0
                  ? `${emprestimo.taxa_multa}% (antigo, não aplicado)`
                  : "Não cobra",
                color: "text-rose-500",
              },
              { label: "Frequência", value: freqLabel[emprestimo.frequencia] || emprestimo.frequencia, color: "text-slate-900" },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</p>
                <p className={`text-sm font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* CONTRATO */}
          <div className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-100">
              {[
                { label: "Vencimento", value: fmtDate(emprestimo.data_vencimento) },
                { label: "Tipo", value: tipoLabel[emprestimo.tipo_pagamento] || emprestimo.tipo_pagamento },
                { label: "Categoria", value: emprestimo.categoria || "Sem categoria" },
                { label: "Emprestou", value: emprestimo.parceiro ? `${emprestimo.parceiro.nome} · Parceiro` : "Capital próprio" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</span>
                  <span className="text-xs font-black text-slate-900 text-right max-w-[55%] truncate">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* OBSERVAÇÕES */}
          {emprestimo.observacoes && (
            <div className="rounded-2xl border bg-amber-50 border-amber-200 p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2">Observações</p>
              <p className="text-xs text-slate-700 leading-relaxed">{emprestimo.observacoes}</p>
            </div>
          )}

          {/* DATA PREVISTA DE PAGAMENTO */}
          {statusReal !== "quitado" && (() => {
            const dp = emprestimo.data_prevista_pagamento;
            let diasDP: number | null = null;
            let urgLabel = "";
            let urgCor = "";
            if (dp) {
              const dpObj = new Date(dp);
              const dpUTC = new Date(Date.UTC(dpObj.getUTCFullYear(), dpObj.getUTCMonth(), dpObj.getUTCDate()));
              diasDP = Math.ceil((dpUTC.getTime() - hojeUTC.getTime()) / 86400000);
              if (diasDP < 0) { urgLabel = `${Math.abs(diasDP)}d atrasada`; urgCor = "rose"; }
              else if (diasDP === 0) { urgLabel = "Vence hoje"; urgCor = "amber"; }
              else if (diasDP <= 2) { urgLabel = `${diasDP}d restantes`; urgCor = "orange"; }
              else { urgLabel = `${diasDP}d restantes`; urgCor = "slate"; }
            }
            return (
              <div className={`rounded-2xl border shadow-sm overflow-hidden ${
                dp && urgCor === "rose" ? "bg-rose-50 border-rose-200" :
                dp && urgCor === "amber" ? "bg-amber-50 border-amber-200" :
                dp && urgCor === "orange" ? "bg-orange-50 border-orange-200" :
                "bg-white border-slate-200"
              }`}>
                <div className="px-4 py-3 border-b border-inherit flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-sm font-black text-slate-900">Data Prevista</span>
                    {dp && (
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                        urgCor === "rose"   ? "bg-rose-100 text-rose-700 border-rose-300" :
                        urgCor === "amber"  ? "bg-amber-100 text-amber-700 border-amber-300" :
                        urgCor === "orange" ? "bg-orange-100 text-orange-700 border-orange-300" :
                        "bg-slate-100 text-slate-600 border-slate-200"
                      }`}>{urgLabel}</span>
                    )}
                  </div>
                  {dp && !showDatePicker && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { setShowDatePicker(true); setDataPrevistaInput(dp); }}
                        className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 transition-colors cursor-pointer"
                      >Editar</button>
                      <button
                        onClick={handleLimparDataPrevista}
                        disabled={isSavingData}
                        className="text-[11px] font-bold text-rose-500 hover:text-rose-700 transition-colors cursor-pointer"
                      >Remover</button>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  {dp && !showDatePicker ? (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-black text-slate-900">{fmtDate(dp)}</span>
                    </div>
                  ) : showDatePicker ? (
                    <div className="flex items-center gap-2 animate-in fade-in duration-150">
                      <input
                        type="date"
                        value={dataPrevistaInput}
                        onChange={(e) => setDataPrevistaInput(e.target.value)}
                        className={inputCls}
                      />
                      <button
                        onClick={handleSalvarDataPrevista}
                        disabled={isSavingData || !dataPrevistaInput}
                        className="flex-shrink-0 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-black rounded-xl transition-all disabled:opacity-60 cursor-pointer shadow-sm"
                      >{isSavingData ? "..." : "Salvar"}</button>
                      <button
                        onClick={() => setShowDatePicker(false)}
                        className="flex-shrink-0 px-2 py-2 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 text-xs font-black rounded-xl transition-all cursor-pointer"
                      ><X className="w-3.5 h-3.5" /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDatePicker(true)}
                      className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-emerald-600 active:scale-95 transition-all cursor-pointer"
                    >
                      <Calendar className="w-4 h-4" />
                      Definir data prevista de pagamento
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* AÇÕES */}
          <div className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-sm font-black text-slate-900">Ações</span>
            </div>
            <div className="p-4 space-y-2">
              {statusReal !== "quitado" && (
                <>
                  {multiplas ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <BtnPrimary onClick={() => pay(false)}><Wallet className="w-3.5 h-3.5" /> Pagar {proximaParcelaAberta ? `Parcela ${proximaParcelaAberta.numero}` : "Parcela"}</BtnPrimary>
                        <button onClick={() => payAll(false)} disabled={isPending} className="flex items-center justify-center gap-1.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-black rounded-xl transition-all active:scale-[0.98] cursor-pointer">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Quitar Tudo
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <BtnPrimary onClick={() => pay(false)}>
                        <CheckCircle2 className="w-4 h-4" /> {isAVista ? `Quitar À Vista (${fmt(saldoRestante > 0 ? saldoRestante : totalEstimado)})` : "Quitar Agora"}
                      </BtnPrimary>
                    </>
                  )}
                  {isAVista && (
                    <button onClick={receiveJuros} disabled={isPending} className="flex items-center justify-center gap-1.5 w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-black rounded-xl transition-all active:scale-[0.98] shadow-sm cursor-pointer">
                      <RefreshCw className="w-4 h-4" /> Receber só os juros — {fmt(valorJurosCalculado)} (renovar +30d)
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <BtnSecondary onClick={() => openModal("renegociar")}><RefreshCw className="w-3.5 h-3.5" /> Renegociar</BtnSecondary>
                    <BtnSecondary onClick={() => openModal("reprogramar")}><CalendarClock className="w-3.5 h-3.5" /> Reprogramar</BtnSecondary>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <BtnSecondary onClick={toggleBL} danger={!emprestimo.cliente.blacklist}>
                  {emprestimo.cliente.blacklist ? <><Shield className="w-3.5 h-3.5" /> Remover BL</> : <><ShieldOff className="w-3.5 h-3.5" /> Lista Negra</>}
                </BtnSecondary>
                <BtnSecondary onClick={whatsapp}><MessageSquare className="w-3.5 h-3.5" /> Lembrete WA</BtnSecondary>
              </div>

              {/* Botão Pausar/Despausar — Acordo com cobrador */}
              {statusReal !== "quitado" && (
                <button
                  onClick={handlePausar}
                  disabled={isPending}
                  className={`flex items-center justify-center gap-1.5 w-full py-2.5 text-sm font-black tracking-wide rounded-xl border transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60 ${
                    isPausado
                      ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200"
                      : "bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border-yellow-200"
                  }`}
                >
                  {isPausado
                    ? <><PlayCircle className="w-4 h-4" /> Despausar Empréstimo</>
                    : <><PauseCircle className="w-4 h-4" /> Pausar (Acordo com Cobrador)</>
                  }
                </button>
              )}


              {/* Ações do Cronograma em PDF */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <button
                  type="button"
                  onClick={handleBaixarPdf}
                  className="flex items-center justify-center gap-1.5 w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-800 text-sm font-black tracking-wide rounded-xl border border-slate-200 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                >
                  <FileDown className="w-4 h-4 text-emerald-600" /> Baixar Cronograma (PDF)
                </button>
                <button
                  type="button"
                  onClick={handleEnviarPdfWa}
                  disabled={isSendingPdfWa}
                  className="flex items-center justify-center gap-1.5 w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-black tracking-wide rounded-xl border border-emerald-200 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60"
                >
                  {isSendingPdfWa ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{isSendingPdfWa ? "Enviando PDF..." : "Enviar Cronograma via WhatsApp"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL: Renegociar ── */}
      {modal === "renegociar" && (
        <Modal isClosing={modalClosing} onClose={closeModal} title="Renegociar Dívida" subtitle="Abate um valor do saldo devedor">
          <form onSubmit={submitReneg} className="space-y-4">
            <div>
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Valor Pago Agora (R$) *</label>
              <input type="number" step="any" required min="0.01" max={saldoRestante} value={valorAbater} onChange={e => setValorAbater(e.target.value)} placeholder="Ex: 500" className={inputCls} />
              <p className="text-xs text-slate-400 mt-1">Saldo atual: <span className="font-bold text-slate-600">{fmt(saldoRestante)}</span></p>
            </div>
            <label className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
              <span className="text-xs font-bold text-slate-600">Cobrar juros sobre saldo restante</span>
              <input type="checkbox" checked={aplicarJuros} onChange={e => setAplicarJuros(e.target.checked)} className="w-4 h-4 accent-emerald-600 cursor-pointer" />
            </label>
            {aplicarJuros && (
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Nova Taxa de Juros (%) *</label>
                <input type="number" step="any" required value={taxaReneg} onChange={e => setTaxaReneg(e.target.value)} placeholder="Ex: 10" className={inputCls} />
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={closeModal} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer">Cancelar</button>
              <button type="submit" disabled={isPending} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
                {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirmar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── MODAL: Reprogramar ── */}
      {modal === "reprogramar" && (
        <Modal isClosing={modalClosing} onClose={closeModal} title="Reprogramar Vencimento" subtitle="Redefine data e condições do contrato">
          <form onSubmit={submitReprog} className="space-y-4">
            <div>
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Nova Data de Vencimento *</label>
              <input type="date" required value={novaData} onChange={e => setNovaData(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Frequência das Parcelas *</label>
              <select value={freqReprog} onChange={e => setFreqReprog(e.target.value)} className={inputCls}>
                <option value="diario">Diário</option>
                <option value="semanal">Semanal</option>
                <option value="quinzenal">Quinzenal</option>
                <option value="mensal">Mensal</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Valor Extra / Adicional (R$)</label>
              <input type="number" step="any" value={extra} onChange={e => setExtra(e.target.value)} placeholder="Ex: 200 (adiciona ao saldo)" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Nova Taxa de Juros (%)</label>
              <input type="number" step="any" value={taxaReprog} onChange={e => setTaxaReprog(e.target.value)} placeholder="Ex: 10 (sobre o novo saldo)" className={inputCls} />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={closeModal} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer">Cancelar</button>
              <button type="submit" disabled={isPending} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
                {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirmar
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── MODAL: Confirmar Exclusão ── */}
      {modal === "delete" && (
        <Modal isClosing={modalClosing} onClose={closeModal} title="Excluir Empréstimo?" subtitle="Esta ação é irreversível e não pode ser desfeita.">
          <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0" />
            <p className="text-xs text-rose-700 font-semibold">Todos os dados deste empréstimo, incluindo parcelas e histórico, serão permanentemente removidos.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={closeModal} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer">Cancelar</button>
            <button onClick={() => { closeModal(); excluir(); }} disabled={isPending} className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
              {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Excluir Definitivamente
            </button>
          </div>
        </Modal>
      )}

      {/* ── MODAL: Confirmar Renovação de Juros (com escolha de WhatsApp) ── */}
      {modal === "renovar_juros" && (
        <Modal 
          isClosing={modalClosing}
          onClose={() => {
            if (isPending) return;
            closeModal();
          }} 
          title={renovFeedback ? (renovFeedback.sucesso ? "Renovação Concluída" : "Aviso na Renovação") : "Renovar Empréstimo (+30 dias)"} 
          subtitle={`Cliente: ${emprestimo.cliente.nome}`}
          maxWidth="max-w-md"
        >
          {renovFeedback ? (
            renovFeedback.sucesso ? (
              <div className="space-y-4 py-1 text-center">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 tracking-tight">Empréstimo Renovado!</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    O recebimento dos juros de <strong className="text-emerald-700">{fmt(valorJurosCalculado)}</strong> foi confirmado e o vencimento foi estendido por mais 30 dias.
                  </p>
                </div>

                {renovFeedback.whatsappEnviado && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 text-left text-xs space-y-2 shadow-sm">
                    <div className="flex items-center gap-1.5 font-black text-emerald-800">
                      <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Comprovante enviado no WhatsApp:</span>
                    </div>
                    {renovFeedback.whatsappTexto && (
                      <p className="text-[11px] font-mono text-emerald-950 bg-white/80 p-3 rounded-xl border border-emerald-200/60 whitespace-pre-wrap leading-relaxed break-words max-h-40 overflow-y-auto">
                        "{renovFeedback.whatsappTexto}"
                      </p>
                    )}
                  </div>
                )}

                {renovFeedback.whatsappErro && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-left text-xs text-amber-900 flex items-start gap-2.5 shadow-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-black text-amber-800">Renovado no sistema, mas WhatsApp não entregou:</span>
                      <p className="text-[11px] text-amber-700 leading-relaxed">{renovFeedback.whatsappErro}</p>
                    </div>
                  </div>
                )}

                {!renovFeedback.whatsappEnviado && !renovFeedback.whatsappErro && (
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs text-slate-600 font-medium">
                    Operação registrada no sistema com sucesso (sem envio de mensagem).
                  </div>
                )}

                <button
                  type="button"
                  onClick={closeModal}
                  className="btn-press w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-emerald-600/20 active:scale-[0.98] cursor-pointer"
                >
                  Concluir
                </button>
              </div>
            ) : (
              <div className="space-y-4 py-1 text-center">
                <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900">Não foi possível renovar</h4>
                  <p className="text-xs text-rose-600 mt-1 font-medium">{renovFeedback.erro}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => setRenovFeedback(null)}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all cursor-pointer shadow-sm"
                  >
                    Tentar Novamente
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {/* Card financeiro de resumo */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Juros a Receber Hoje</span>
                  <span className="text-base font-black text-emerald-600 tabular-nums">{fmt(valorJurosCalculado)}</span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Principal Mantido</span>
                  <span className="text-xs font-bold text-slate-700 tabular-nums">{fmt(emprestimo.valor_emprestado)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Novo Vencimento</span>
                  <span className="inline-flex items-center gap-1 font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[10px]">
                    <CalendarClock className="w-3 h-3" /> +30 dias
                  </span>
                </div>
              </div>

              {/* Informação */}
              <p className="text-xs text-slate-500 leading-relaxed">
                Dar baixa no recebimento dos juros (<strong className="text-slate-700 font-bold">{fmt(valorJurosCalculado)}</strong>) e estender o vencimento do contrato por mais 30 dias.
              </p>

              {/* Opção WhatsApp com card interativo e responsivo */}
              <button
                type="button"
                onClick={() => setRenovEnviarWa(!renovEnviarWa)}
                className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                  renovEnviarWa
                    ? "bg-emerald-50/80 border-emerald-300 text-emerald-950 shadow-sm"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2.5 rounded-xl shrink-0 transition-colors ${renovEnviarWa ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-200 text-slate-500"}`}>
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black truncate">Enviar comprovante via WhatsApp</p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      Para: {emprestimo.cliente.nome} {emprestimo.cliente.telefone ? `(${emprestimo.cliente.telefone})` : ""}
                    </p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                  renovEnviarWa
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-white border-slate-300"
                }`}>
                  {renovEnviarWa && <CheckCircle2 className="w-3.5 h-3.5" />}
                </div>
              </button>

              {/* Botões de Ação */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => executarRenovacao(renovEnviarWa)}
                  disabled={isPending}
                  className="btn-press w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-[0.98] cursor-pointer disabled:opacity-50"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processando renovação...</span>
                    </>
                  ) : (
                    <>
                      {renovEnviarWa ? <MessageSquare className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>{renovEnviarWa ? "Confirmar Renovação e Enviar WhatsApp" : "Confirmar Renovação no Sistema"}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isPending}
                  className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── MODAL: Disparo WhatsApp via Plataforma ── */}
      {modal === "wa" && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${
          modalClosing ? "motion-modal-backdrop-out" : "motion-modal-backdrop-in"
        }`}>
          <div className={`bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 flex flex-col overflow-hidden ${
            modalClosing ? "motion-modal-card-out" : "motion-modal-card-in"
          }`}>
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="font-black text-slate-900 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-500" />
                  Enviar Mensagem
                </h3>
                <p className="text-xs text-slate-500 mt-1">Para {emprestimo.cliente.nome}</p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Respostas Rápidas</label>
                  <Link href="/configuracoes/mensagens#respostas" className="text-xs flex items-center gap-1 font-bold text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer">
                    Editar modelos
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  {waTemplates.map((msg, i) => (
                    <button key={i} onClick={() => sendWaMsg(msg)} disabled={isWaSending} className="text-left p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 hover:border-emerald-500 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                      {msg.replace(/\{nome_completo\}/g, emprestimo.cliente.nome).replace(/\{nome\}/g, emprestimo.cliente.nome.split(" ")[0])}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Mensagem Personalizada</label>
                <textarea 
                  value={waCustomMsg}
                  onChange={(e) => setWaCustomMsg(e.target.value)}
                  placeholder="Digite sua mensagem livre aqui..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 min-h-[100px] resize-y"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Dica: {"{nome}"}, {"{valor}"}, {"{data}"} e outras variáveis são preenchidas automaticamente no envio.
                </p>
              </div>
            </div>
            
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => sendWaMsg(waCustomMsg)}
                disabled={!waCustomMsg.trim() || isWaSending}
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isWaSending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {isWaSending ? "Enviando..." : "Enviar Mensagem"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR DATA PAGAMENTO */}
      {editingParcela && (
        <Modal isClosing={editingParcelaClosing} onClose={closeEditingParcela} title="Editar Data do Pagamento" subtitle={`Parcela ${editingParcela.numero}`}>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">Data em que o pagamento foi realizado</label>
              <input
                type="date"
                className={inputCls}
                value={editingParcela.data}
                onChange={(e) => setEditingParcela({ ...editingParcela, data: e.target.value })}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={closeEditingParcela}
                className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isSavingParcelaData || !editingParcela.data}
                onClick={async () => {
                  setIsSavingParcelaData(true);
                  try {
                    await atualizarDataPagamentoParcela(editingParcela.id, emprestimo.id, editingParcela.data);
                    closeEditingParcela();
                  } catch (err: any) {
                    alert(err.message || "Erro ao atualizar data");
                  } finally {
                    setIsSavingParcelaData(false);
                  }
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isSavingParcelaData ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Salvar Data
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
