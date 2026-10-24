"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Loader2,
  MessageSquare,
  PauseCircle,
  RefreshCw,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  payFullLoan,
  payInstallmentById,
  receberSoJurosEmprestimo,
  renegociarEmprestimo,
  reprogramarEmprestimo,
  salvarDataPrevistaPagamento,
  togglePausarEmprestimo,
} from "@/app/emprestimos/[id]/actions";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import { calcularJurosAtraso, descreverRegraAtraso } from "@/lib/jurosAtraso";
import { formatBRL, formatData, isParcelaUnica, type Parcela, type TipoAcaoEmprestimo } from "./tipos";

interface AcaoEmprestimoModalProps {
  parcela: Parcela;
  acao: TipoAcaoEmprestimo;
  onClose: () => void;
  onSuccess: (mensagem: string) => void;
}

const inputCls =
  "w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all placeholder:text-slate-400";

export default function AcaoEmprestimoModal({
  parcela: p,
  acao,
  onClose,
  onSuccess,
}: AcaoEmprestimoModalProps) {
  const [closing, setClosing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const emp = p.emprestimo;
  const cliente = emp.cliente;
  const aVista = isParcelaUnica(p);
  const valorJurosRenovacao = emp.valor_emprestado * (emp.taxa_juros / 100);

  // Cálculo de juros de atraso da parcela atual
  const hojeUTC = hojeEmBrasilia();
  const regraAtraso = { tipo: emp.atraso_tipo, valor: emp.atraso_valor };
  const atrasoParcela = calcularJurosAtraso(regraAtraso, p.valor, p.data_vencimento, hojeUTC);

  // Estados compartilhados / específicos por ação
  const [enviarWa, setEnviarWa] = useState(true);
  const [cobrarJurosAtraso, setCobrarJurosAtraso] = useState(true);

  // Reprogramar
  const [novaData, setNovaData] = useState("");
  const [freqReprog, setFreqReprog] = useState(emp.frequencia || "mensal");
  const [extra, setExtra] = useState("");
  const [taxaReprog, setTaxaReprog] = useState("");

  // Renegociar (Abater)
  const [valorAbater, setValorAbater] = useState("");
  const [aplicarJurosReneg, setAplicarJurosReneg] = useState(false);
  const [taxaReneg, setTaxaReneg] = useState("10");

  // Data Prevista
  const [dataPrevista, setDataPrevista] = useState(emp.data_prevista_pagamento ?? "");

  const fechar = () => {
    if (isPending || closing) return;
    setClosing(true);
    setTimeout(() => {
      onClose();
    }, 150);
  };

  useEffect(() => {
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPending) fechar();
    };
    document.addEventListener("keydown", aoTecla);
    return () => document.removeEventListener("keydown", aoTecla);
  }, [isPending, closing]);

  const titulos: Record<TipoAcaoEmprestimo, { titulo: string; subtitulo: string }> = {
    renovar: {
      titulo: "Renovar Empréstimo (+30 dias)",
      subtitulo: `Receber só os juros de ${cliente.nome}`,
    },
    quitar: {
      titulo: aVista || emp.parcelasAbertasCount <= 1 ? "Quitar Empréstimo" : "Quitar Todo o Empréstimo",
      subtitulo: `Cliente: ${cliente.nome}`,
    },
    pagar_parcela: {
      titulo: `Pagar Parcela ${p.numero}/${emp.totalParcelas}`,
      subtitulo: `Cliente: ${cliente.nome}`,
    },
    reprogramar: {
      titulo: "Reprogramar Vencimento",
      subtitulo: `Redefinir data e condições — ${cliente.nome}`,
    },
    renegociar: {
      titulo: "Renegociar / Abater Valor",
      subtitulo: `Abater pagamento parcial — ${cliente.nome}`,
    },
    data_prevista: {
      titulo: "Data Prevista de Pagamento",
      subtitulo: `Promessa de pagamento — ${cliente.nome}`,
    },
    pausar: {
      titulo: "Pausar Empréstimo",
      subtitulo: `Acordo com cobrador — ${cliente.nome}`,
    },
  };

  const handleConfirmarRenovacao = (enviarWhatsapp = enviarWa) => {
    setErro(null);
    startTransition(async () => {
      try {
        await receberSoJurosEmprestimo(emp.id, enviarWhatsapp);
        onSuccess(
          enviarWhatsapp
            ? `Empréstimo de ${cliente.nome.split(" ")[0]} renovado e aviso enviado no WhatsApp!`
            : `Empréstimo de ${cliente.nome.split(" ")[0]} renovado (sem envio no WhatsApp)!`
        );
      } catch (err: any) {
        setErro(err?.message || "Erro ao renovar empréstimo.");
      }
    });
  };

  const handleConfirmarQuitacao = () => {
    setErro(null);
    startTransition(async () => {
      try {
        const comAtraso = p.diasAtraso > 0;
        await payFullLoan(emp.id, comAtraso, cobrarJurosAtraso, enviarWa);
        onSuccess(`Empréstimo de ${cliente.nome.split(" ")[0]} quitado com sucesso!`);
      } catch (err: any) {
        setErro(err?.message || "Erro ao quitar empréstimo.");
      }
    });
  };

  const handleConfirmarParcela = () => {
    setErro(null);
    startTransition(async () => {
      try {
        const comAtraso = p.diasAtraso > 0;
        await payInstallmentById(p.id, comAtraso, cobrarJurosAtraso, enviarWa);
        onSuccess(`Parcela ${p.numero} de ${cliente.nome.split(" ")[0]} recebida!`);
      } catch (err: any) {
        setErro(err?.message || "Erro ao registrar pagamento da parcela.");
      }
    });
  };

  const handleConfirmarReprogramacao = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (!novaData) {
      setErro("Informe a nova data de vencimento.");
      return;
    }
    startTransition(async () => {
      try {
        await reprogramarEmprestimo(
          emp.id,
          novaData,
          extra ? Number(extra) : 0,
          taxaReprog ? Number(taxaReprog) : 0,
          freqReprog,
          enviarWa
        );
        onSuccess(`Vencimento de ${cliente.nome.split(" ")[0]} reprogramado!`);
      } catch (err: any) {
        setErro(err?.message || "Erro ao reprogramar empréstimo.");
      }
    });
  };

  const handleConfirmarRenegociacao = (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    const v = Number(valorAbater);
    if (!v || v <= 0) {
      setErro("Informe um valor válido maior que zero.");
      return;
    }
    startTransition(async () => {
      try {
        await renegociarEmprestimo(
          emp.id,
          v,
          aplicarJurosReneg,
          aplicarJurosReneg ? Number(taxaReneg) : 0
        );
        onSuccess(`Renegociação de ${cliente.nome.split(" ")[0]} registrada!`);
      } catch (err: any) {
        setErro(err?.message || "Erro ao renegociar empréstimo.");
      }
    });
  };

  const handleSalvarDataPrevista = (dataSalvar: string | null) => {
    setErro(null);
    startTransition(async () => {
      try {
        await salvarDataPrevistaPagamento(emp.id, dataSalvar);
        onSuccess(
          dataSalvar
            ? `Data prevista definida para ${formatData(dataSalvar)}`
            : "Data prevista removida"
        );
      } catch (err: any) {
        setErro(err?.message || "Erro ao salvar data prevista.");
      }
    });
  };

  const handleConfirmarPausa = () => {
    setErro(null);
    startTransition(async () => {
      try {
        await togglePausarEmprestimo(emp.id, "ativo");
        onSuccess(`Empréstimo de ${cliente.nome.split(" ")[0]} pausado`);
      } catch (err: any) {
        setErro(err?.message || "Erro ao pausar empréstimo.");
      }
    });
  };

  const { titulo, subtitulo } = titulos[acao];

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) fechar();
      }}
      className={`fixed inset-0 p-3 sm:p-4 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm ${
        closing ? "motion-modal-backdrop-out" : "motion-modal-backdrop-in"
      }`}
    >
      <div
        className={`bg-white border border-slate-200 rounded-3xl w-full max-w-md max-h-[calc(100dvh-2rem)] flex flex-col shadow-2xl overflow-hidden ${
          closing ? "motion-modal-card-out" : "motion-modal-card-in"
        }`}
      >
        {/* Cabeçalho */}
        <div className="flex items-start justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/60 shrink-0">
          <div className="min-w-0 pr-2">
            <h3 className="font-black text-sm sm:text-base text-slate-900 tracking-tight">{titulo}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitulo}</p>
          </div>
          <button
            type="button"
            onClick={fechar}
            disabled={isPending}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0 cursor-pointer shadow-sm active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {erro && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          {/* ── 1. RENOVAR (+30 DIAS) ── */}
          {acao === "renovar" && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    Juros a Receber Hoje ({emp.taxa_juros}%)
                  </span>
                  <span className="text-base font-black text-emerald-600 tabular-nums">
                    {formatBRL(valorJurosRenovacao)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    Principal Mantido
                  </span>
                  <span className="text-xs font-bold text-slate-700 tabular-nums">
                    {formatBRL(emp.valor_emprestado)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    Novo Vencimento
                  </span>
                  <span className="inline-flex items-center gap-1 font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[10px]">
                    <CalendarClock className="w-3 h-3" /> +30 dias
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-500 leading-relaxed">
                Confirma o recebimento apenas dos juros (
                <strong className="text-slate-700">{formatBRL(valorJurosRenovacao)}</strong>) e prorroga o
                vencimento do contrato por mais 30 dias.
              </p>

              <p className="text-xs text-slate-700 font-bold">
                Deseja enviar a confirmação da renovação no WhatsApp de {cliente.nome}?
              </p>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleConfirmarRenovacao(true)}
                  disabled={isPending}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                  <span>{isPending ? "Renovando..." : "Sim, Renovar e Enviar no WhatsApp"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmarRenovacao(false)}
                  disabled={isPending}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <RefreshCw className="w-4 h-4 text-slate-600" />
                  <span>Não, Renovar sem Enviar no WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={fechar}
                  disabled={isPending}
                  className="w-full py-2 text-slate-400 hover:text-slate-600 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── 2. QUITAR EMPRÉSTIMO ou PAGAR PARCELA ── */}
          {(acao === "quitar" || acao === "pagar_parcela") && (() => {
            const valorBase = acao === "pagar_parcela" ? p.valor : emp.saldoRestante;
            const jurosExtra = cobrarJurosAtraso ? atrasoParcela.juros : 0;
            const totalReceber = valorBase + jurosExtra;

            return (
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      {acao === "pagar_parcela"
                        ? `Valor da Parcela ${p.numero}`
                        : emp.parcelasAbertasCount > 1
                        ? `Saldo Restante (${emp.parcelasAbertasCount} parcelas)`
                        : "Valor da Quitação"}
                    </span>
                    <span className="text-sm font-black text-slate-800 tabular-nums">{formatBRL(valorBase)}</span>
                  </div>

                  {atrasoParcela.juros > 0 && (
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/60">
                      <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                        Juros de Atraso ({atrasoParcela.dias}d · {descreverRegraAtraso(regraAtraso)})
                      </span>
                      <span
                        className={`text-xs font-black tabular-nums ${
                          cobrarJurosAtraso ? "text-rose-600" : "text-slate-400 line-through"
                        }`}
                      >
                        + {formatBRL(atrasoParcela.juros)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200">
                    <span className="text-slate-700 font-black uppercase tracking-wider text-[10px]">
                      Total a Receber
                    </span>
                    <span className="text-base font-black text-emerald-600 tabular-nums">
                      {formatBRL(totalReceber)}
                    </span>
                  </div>
                </div>

                {atrasoParcela.juros > 0 && (
                  <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 cursor-pointer hover:bg-slate-100 transition-colors">
                    <div>
                      <span className="text-xs font-bold text-slate-700 block">Cobrar juros de atraso</span>
                      <span className="text-[11px] text-slate-400">
                        Desmarque para perdoar o acréscimo de {formatBRL(atrasoParcela.juros)}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={cobrarJurosAtraso}
                      onChange={(e) => setCobrarJurosAtraso(e.target.checked)}
                      className="w-4 h-4 accent-emerald-600 cursor-pointer"
                    />
                  </label>
                )}

                {/* Toggle WhatsApp */}
                <button
                  type="button"
                  onClick={() => setEnviarWa(!enviarWa)}
                  className={`w-full p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                    enviarWa
                      ? "bg-emerald-50/80 border-emerald-300 text-emerald-950 shadow-sm"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-xl shrink-0 transition-colors ${
                        enviarWa ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black truncate">Enviar confirmação via WhatsApp</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{cliente.nome}</p>
                    </div>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                      enviarWa ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-300"
                    }`}
                  >
                    {enviarWa && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                </button>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={fechar}
                    disabled={isPending}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={acao === "pagar_parcela" ? handleConfirmarParcela : handleConfirmarQuitacao}
                    disabled={isPending}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    {isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : acao === "pagar_parcela" ? (
                      <Wallet className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>
                      {isPending
                        ? "Confirmando..."
                        : acao === "pagar_parcela"
                        ? `Receber ${formatBRL(totalReceber)}`
                        : `Quitar (${formatBRL(totalReceber)})`}
                    </span>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── 3. REPROGRAMAR VENCIMENTO ── */}
          {acao === "reprogramar" && (
            <form onSubmit={handleConfirmarReprogramacao} className="space-y-3.5">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                  Nova Data de Vencimento *
                </label>
                <input
                  type="date"
                  required
                  value={novaData}
                  onChange={(e) => setNovaData(e.target.value)}
                  className={inputCls}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Vencimento atual: <strong className="text-slate-600">{formatData(p.data_vencimento)}</strong>
                </p>
              </div>

              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                  Frequência das Parcelas *
                </label>
                <select value={freqReprog} onChange={(e) => setFreqReprog(e.target.value)} className={inputCls}>
                  <option value="diario">Diário</option>
                  <option value="semanal">Semanal</option>
                  <option value="quinzenal">Quinzenal</option>
                  <option value="mensal">Mensal</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                    Valor Extra (R$)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    placeholder="Opcional"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                    Juros Adicional (%)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={taxaReprog}
                    onChange={(e) => setTaxaReprog(e.target.value)}
                    placeholder="Opcional"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={fechar}
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                  <span>{isPending ? "Salvando..." : "Reprogramar"}</span>
                </button>
              </div>
            </form>
          )}

          {/* ── 4. RENEGOCIAR / ABATER VALOR ── */}
          {acao === "renegociar" && (
            <form onSubmit={handleConfirmarRenegociacao} className="space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                  Valor Pago Agora (R$) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  min="0.01"
                  max={emp.saldoRestante}
                  value={valorAbater}
                  onChange={(e) => setValorAbater(e.target.value)}
                  placeholder="Ex: 200"
                  className={inputCls}
                />
                <p className="text-xs text-slate-400 mt-1">
                  Saldo em aberto: <span className="font-bold text-slate-600">{formatBRL(emp.saldoRestante)}</span>
                </p>
              </div>

              <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <span className="text-xs font-bold text-slate-700">
                  Cobrar juros sobre o saldo restante (+30d)
                </span>
                <input
                  type="checkbox"
                  checked={aplicarJurosReneg}
                  onChange={(e) => setAplicarJurosReneg(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 cursor-pointer"
                />
              </label>

              {aplicarJurosReneg && (
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                    Nova Taxa de Juros (%) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={taxaReneg}
                    onChange={(e) => setTaxaReneg(e.target.value)}
                    placeholder="Ex: 10"
                    className={inputCls}
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={fechar}
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                  <span>{isPending ? "Aplicando..." : "Confirmar Abatimento"}</span>
                </button>
              </div>
            </form>
          )}

          {/* ── 5. DATA PREVISTA DE PAGAMENTO ── */}
          {acao === "data_prevista" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1.5 block">
                  Data prometida pelo cliente
                </label>
                <input
                  type="date"
                  value={dataPrevista}
                  onChange={(e) => setDataPrevista(e.target.value)}
                  className={inputCls}
                />
                <p className="text-xs text-slate-400 mt-1.5">
                  A data prevista aparece destacada na linha do cliente sem alterar o vencimento original do contrato.
                </p>
              </div>

              {emp.data_prevista_pagamento && (
                <button
                  type="button"
                  onClick={() => handleSalvarDataPrevista(null)}
                  disabled={isPending}
                  className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-black rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remover data prevista atual ({formatData(emp.data_prevista_pagamento)})
                </button>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={fechar}
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleSalvarDataPrevista(dataPrevista)}
                  disabled={isPending || !dataPrevista}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
                  <span>Salvar Data</span>
                </button>
              </div>
            </div>
          )}

          {/* ── 6. PAUSAR EMPRÉSTIMO (ACORDO) ── */}
          {acao === "pausar" && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 font-medium leading-relaxed">
                  Ao pausar este empréstimo, ele sairá da fila de <strong>Cobranças</strong> e dos alertas do{" "}
                  <strong>Dashboard</strong> até que seja despausado na tela do empréstimo.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={fechar}
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmarPausa}
                  disabled={isPending}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PauseCircle className="w-4 h-4" />}
                  <span>{isPending ? "Pausando..." : "Pausar Empréstimo"}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
