"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, ListChecks, Check, X, RefreshCw, CalendarClock, CheckCircle2, Trash2,
  ChevronRight, Loader2, AlertCircle, FileDown, Send,
} from "lucide-react";
import {
  alterarEmprestimosEmMassa,
  type AcaoEmMassa,
  type ResultadoEmMassa,
} from "@/app/clientes/[id]/actions";
import { legendaCronograma } from "@/app/mensagens/actions";
import {
  baixarEmprestimosEmMassaPdf,
  obterEmprestimosEmMassaPdfBase64,
  obterNomeArquivoEmprestimosPdf,
  type ParcelaPdfItem,
} from "@/lib/cronogramaPdf";

export interface EmprestimoClienteItem {
  id: string;
  vencimento: string; // dd/mm/aaaa já formatado
  dataInicio?: string | null;
  situacao: "quitado" | "atrasado" | "hoje" | "em_dia";
  status?: string;
  tipoPagamento?: string;
  frequencia?: string;
  principal: number;
  total: number;
  valorJuros: number;
  taxaJuros: number;
  taxaMulta: number;
  atrasoTipo?: string | null;
  atrasoValor?: number | null;
  observacoes?: string | null;
  parcelas?: ParcelaPdfItem[];
}

interface Props {
  clienteId: string;
  clienteNome?: string;
  clienteTelefone?: string;
  clienteDocumento?: string | null;
  emprestimos: EmprestimoClienteItem[];
}

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const badgeClasses: Record<EmprestimoClienteItem["situacao"], { cls: string; label: string }> = {
  quitado: { cls: "bg-slate-100 text-slate-600", label: "Quitado" },
  atrasado: { cls: "bg-rose-100 text-rose-700", label: "Atrasado" },
  hoje: { cls: "bg-amber-100 text-amber-700", label: "Vencendo Hoje" },
  em_dia: { cls: "bg-emerald-100 text-emerald-700", label: "Em dia" },
};

const acoes: {
  id: AcaoEmMassa; titulo: string; descricao: string; icone: React.ReactNode; cor: string; botao: string;
}[] = [
  { id: "renovar", titulo: "Renovar", descricao: "Recebe só os juros e renova +30 dias (empréstimos à vista).", icone: <RefreshCw className="w-5 h-5" />, cor: "text-amber-600 bg-amber-50", botao: "bg-amber-500 hover:bg-amber-600" },
  { id: "reprogramar", titulo: "Reprogramar", descricao: "Move todos para uma mesma data de vencimento.", icone: <CalendarClock className="w-5 h-5" />, cor: "text-blue-600 bg-blue-50", botao: "bg-blue-600 hover:bg-blue-700" },
  { id: "quitar", titulo: "Quitar", descricao: "Quita todos os selecionados de uma vez.", icone: <CheckCircle2 className="w-5 h-5" />, cor: "text-emerald-600 bg-emerald-50", botao: "bg-emerald-600 hover:bg-emerald-700" },
  { id: "excluir", titulo: "Excluir", descricao: "Apaga os empréstimos selecionados. Não dá para desfazer.", icone: <Trash2 className="w-5 h-5" />, cor: "text-rose-600 bg-rose-50", botao: "bg-rose-600 hover:bg-rose-700" },
];

export default function EmprestimosClienteCard({
  clienteId,
  clienteNome = "Cliente",
  clienteTelefone = "",
  clienteDocumento = null,
  emprestimos,
}: Props) {
  const router = useRouter();
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Modal: null = fechado | "menu" = escolhendo a ação | "pdf" = opções de baixar/enviar PDF | AcaoEmMassa = confirmando
  const [modal, setModal] = useState<null | "menu" | "pdf" | AcaoEmMassa>(null);
  const [novaData, setNovaData] = useState("");
  const [cobrarJuros, setCobrarJuros] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoEmMassa | null>(null);
  const [isPending, startTransition] = useTransition();

  // Estados do fluxo de PDF em massa
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<"baixar" | "enviar" | null>(null);
  const [pdfFeedback, setPdfFeedback] = useState<{
    tipo: "sucesso" | "aviso" | "erro";
    texto: string;
  } | null>(null);

  // ── Seleção por arrastar (dedo no mobile / mouse) ──
  // O arraste só começa pela "área de seleção" à esquerda de cada linha, que tem touch-action: none;
  // assim o resto da linha continua rolando a página normalmente.
  const dragModo = useRef<"add" | "remove" | null>(null);

  useEffect(() => {
    const parar = () => { dragModo.current = null; };
    window.addEventListener("pointerup", parar);
    window.addEventListener("pointercancel", parar);
    return () => {
      window.removeEventListener("pointerup", parar);
      window.removeEventListener("pointercancel", parar);
    };
  }, []);

  const aplicar = (id: string, modo: "add" | "remove") =>
    setSelecionados((prev) => {
      if ((modo === "add") === prev.has(id)) return prev;
      const next = new Set(prev);
      if (modo === "add") next.add(id); else next.delete(id);
      return next;
    });

  const alternar = (id: string) =>
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const onZonaPointerDown = (e: React.PointerEvent, id: string) => {
    dragModo.current = selecionados.has(id) ? "remove" : "add";
    aplicar(id, dragModo.current);
  };

  const onListaPointerMove = (e: React.PointerEvent) => {
    if (!dragModo.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-emp-id]");
    const id = el?.getAttribute("data-emp-id");
    if (id) aplicar(id, dragModo.current);
  };

  const todosSelecionados = emprestimos.length > 0 && selecionados.size === emprestimos.length;
  const alternarTodos = () =>
    setSelecionados(todosSelecionados ? new Set() : new Set(emprestimos.map((e) => e.id)));

  const selecionarTodos = () =>
    setSelecionados(new Set(emprestimos.map((e) => e.id)));

  const emprestimosEmAberto = useMemo(
    () => emprestimos.filter((e) => e.situacao !== "quitado"),
    [emprestimos]
  );

  const selecionarApenasEmAberto = () =>
    setSelecionados(new Set(emprestimosEmAberto.map((e) => e.id)));

  const sair = () => {
    setModoSelecao(false);
    setSelecionados(new Set());
  };

  const itensSelecionados = useMemo(
    () => emprestimos.filter((e) => selecionados.has(e.id)),
    [emprestimos, selecionados]
  );
  const capitalSelecionado = itensSelecionados.reduce((acc, e) => acc + e.principal, 0);
  const jurosSelecionado = itensSelecionados.reduce((acc, e) => acc + e.valorJuros, 0);
  const totalSelecionado = itensSelecionados.reduce((acc, e) => acc + e.total, 0);

  const abrirModalPdf = () => {
    setErro(null);
    setPdfFeedback(null);
    if (!modoSelecao) {
      setModoSelecao(true);
    }
    setModal("pdf");
  };

  const fecharModal = () => {
    if (isPending || isGeneratingPdf) return;
    const terminou = !!resultado;
    setModal(null);
    setResultado(null);
    setErro(null);
    setPdfFeedback(null);
    setNovaData("");
    setCobrarJuros(true);
    if (terminou) {
      sair();
      router.refresh();
    }
  };

  const montarDadosPdf = () => ({
    clienteNome,
    clienteDocumento,
    clienteTelefone,
    dataGeracao: new Date(),
    emprestimos: itensSelecionados.map((emp) => ({
      id: emp.id,
      vencimento: emp.vencimento,
      dataInicio: emp.dataInicio,
      situacao: emp.situacao,
      status: emp.status,
      tipoPagamento: emp.tipoPagamento,
      frequencia: emp.frequencia,
      principal: emp.principal,
      total: emp.total,
      valorJuros: emp.valorJuros,
      taxaJuros: emp.taxaJuros,
      taxaMulta: emp.taxaMulta,
      atrasoTipo: emp.atrasoTipo,
      atrasoValor: emp.atrasoValor,
      observacoes: emp.observacoes,
      parcelas: emp.parcelas || [],
    })),
  });

  const handleSoBaixarPdf = () => {
    if (itensSelecionados.length === 0) {
      setErro("Selecione pelo menos um empréstimo para gerar o PDF.");
      return;
    }
    setErro(null);
    setPdfFeedback(null);
    setIsGeneratingPdf("baixar");
    try {
      const payload = montarDadosPdf();
      baixarEmprestimosEmMassaPdf(payload);
      setPdfFeedback({
        tipo: "sucesso",
        texto: `PDF com ${itensSelecionados.length} empréstimo${
          itensSelecionados.length !== 1 ? "s" : ""
        } baixado com sucesso no seu dispositivo!`,
      });
    } catch (err) {
      console.error("Erro ao gerar PDF em massa:", err);
      setErro("Não foi possível gerar o PDF dos empréstimos selecionados.");
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  const handleBaixarEEnviarPdf = async () => {
    if (itensSelecionados.length === 0) {
      setErro("Selecione pelo menos um empréstimo para gerar e enviar o PDF.");
      return;
    }
    setErro(null);
    setPdfFeedback(null);
    setIsGeneratingPdf("enviar");

    try {
      const payload = montarDadosPdf();
      const nomeArquivo = obterNomeArquivoEmprestimosPdf(clienteNome, itensSelecionados.length);

      // 1. Baixar o PDF no dispositivo do usuário
      baixarEmprestimosEmMassaPdf(payload, nomeArquivo);

      // 2. Verificar se o cliente possui telefone cadastrado
      if (!clienteTelefone || !clienteTelefone.trim()) {
        setPdfFeedback({
          tipo: "aviso",
          texto: "O PDF foi baixado no seu dispositivo, mas este cliente não possui telefone cadastrado para envio via WhatsApp.",
        });
        return;
      }

      // 3. Gerar Base64 do mesmo PDF e enviar via WhatsApp
      const pdfBase64 = obterEmprestimosEmMassaPdfBase64(payload);
      let caption = `Olá ${clienteNome}, segue em anexo o demonstrativo detalhado dos seus ${itensSelecionados.length} empréstimos.`;
      if (itensSelecionados.length === 1) {
        try {
          caption = await legendaCronograma(itensSelecionados[0].id);
        } catch {
          // Mantém a legenda padrão caso falhe
        }
      }

      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              phone: clienteTelefone,
              document: pdfBase64,
              mimetype: "application/pdf",
              fileName: nomeArquivo,
              caption,
            },
          ],
        }),
      });

      if (res.ok) {
        setPdfFeedback({
          tipo: "sucesso",
          texto: `PDF baixado e enviado com sucesso para o WhatsApp de ${clienteNome}!`,
        });
      } else {
        const d = await res.json().catch(() => ({}));
        setPdfFeedback({
          tipo: "aviso",
          texto: `O PDF foi baixado no seu dispositivo, porém não foi possível enviar no WhatsApp: ${
            d?.error || "Verifique se o WhatsApp está conectado."
          }`,
        });
      }
    } catch (err) {
      console.error("Erro ao baixar/enviar PDF em massa:", err);
      setPdfFeedback({
        tipo: "aviso",
        texto: "O PDF foi baixado, mas houve falha de conexão ao tentar enviar para o WhatsApp.",
      });
    } finally {
      setIsGeneratingPdf(null);
    }
  };

  const confirmar = (acao: AcaoEmMassa) => {
    setErro(null);
    if (acao === "reprogramar" && !novaData) {
      setErro("Escolha a nova data de vencimento.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await alterarEmprestimosEmMassa(clienteId, Array.from(selecionados), acao, {
          novaData: novaData || undefined,
          cobrarJurosAtraso: cobrarJuros,
        });
        setResultado(res);
      } catch (err: unknown) {
        setErro((err instanceof Error && err.message) || "Erro ao aplicar a ação.");
      }
    });
  };

  const acaoAtual = acoes.find((a) => a.id === modal);
  const rotuloItem = (id: string) => {
    const e = emprestimos.find((x) => x.id === id);
    return e ? `Venc. ${e.vencimento} · ${formatBRL(e.total)}` : id;
  };

  return (
    <div className="premium-card overflow-hidden bg-white border border-slate-200 shadow-sm rounded-2xl">
      {/* Cabeçalho */}
      <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold text-slate-900">
          Empréstimos
          {modoSelecao && (
            <span className="ml-2 text-xs font-semibold text-slate-400">
              {selecionados.size} selecionado{selecionados.size !== 1 ? "s" : ""}
            </span>
          )}
        </h2>

        {modoSelecao ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={alternarTodos}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              {todosSelecionados ? "Limpar" : "Selecionar todos"}
            </button>
            <button
              onClick={sair}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              onClick={abrirModalPdf}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Baixar PDF ou enviar no WhatsApp dos empréstimos selecionados"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Baixar PDF{selecionados.size > 0 ? ` (${selecionados.size})` : ""}</span>
            </button>
            <button
              onClick={() => setModal("menu")}
              disabled={selecionados.size === 0}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Alterar{selecionados.size > 0 ? ` (${selecionados.size})` : ""}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {emprestimos.length > 0 && (
              <>
                <button
                  onClick={() => {
                    setModoSelecao(true);
                    if (selecionados.size === 0) {
                      selecionarTodos();
                    }
                    setErro(null);
                    setPdfFeedback(null);
                    setModal("pdf");
                  }}
                  className="flex items-center space-x-1 bg-slate-100 text-slate-700 p-2 rounded-lg text-xs font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Baixar PDF</span>
                </button>
                <button
                  onClick={() => setModoSelecao(true)}
                  className="flex items-center space-x-1 bg-slate-100 text-slate-700 p-2 rounded-lg text-xs font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
                >
                  <ListChecks className="w-4 h-4" />
                  <span>Alterar Em Massa</span>
                </button>
              </>
            )}
            <Link
              href={`/emprestimos/novo?clienteId=${clienteId}`}
              className="flex items-center space-x-1 bg-emerald-50 text-emerald-700 p-2 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Criar Empréstimo</span>
            </Link>
          </div>
        )}
      </div>

      {modoSelecao && (
        <div className="px-5 py-2 bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
          Toque nos empréstimos para selecionar. No celular, arraste o dedo para baixo sobre a caixa à esquerda para selecionar vários.
        </div>
      )}

      {/* Lista */}
      <div className="divide-y divide-slate-100" onPointerMove={modoSelecao ? onListaPointerMove : undefined}>
        {emprestimos.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            Nenhum empréstimo cadastrado para esta pessoa.
          </div>
        ) : (
          emprestimos.map((emp) => {
            const badge = badgeClasses[emp.situacao];
            const conteudo = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span className="text-xs font-bold text-slate-900">Vencimento: {emp.vencimento}</span>
                    <span className={`${badge.cls} text-xs font-bold px-2 py-0.5 rounded-full uppercase`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Taxa de juros: {emp.taxaJuros}% ({formatBRL(emp.valorJuros)}) | Multa: {emp.taxaMulta}%
                  </div>
                </div>
                <div className="text-left sm:text-right shrink-0 pt-1 sm:pt-0">
                  <div className="text-sm font-bold text-slate-900">
                    {formatBRL(emp.principal)} → <span className="text-emerald-600">{formatBRL(emp.total)}</span>
                  </div>
                </div>
              </>
            );

            if (!modoSelecao) {
              return (
                <Link
                  key={emp.id}
                  href={`/emprestimos/${emp.id}`}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 hover:bg-slate-50/60 transition-colors"
                >
                  {conteudo}
                </Link>
              );
            }

            const marcado = selecionados.has(emp.id);
            return (
              <div
                key={emp.id}
                data-emp-id={emp.id}
                role="checkbox"
                aria-checked={marcado}
                onClick={() => alternar(emp.id)}
                className={`px-4 py-4 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                  marcado ? "bg-emerald-50/70" : "hover:bg-slate-50/60"
                }`}
              >
                {/* Área de seleção/arraste (touch-action: none para o arraste não rolar a página) */}
                <div
                  onPointerDown={(e) => onZonaPointerDown(e, emp.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="-my-4 -ml-4 pl-4 pr-3 py-4 self-stretch flex items-center touch-none"
                >
                  <span
                    className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                      marcado ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-300"
                    }`}
                  >
                    {marcado && <Check className="w-4 h-4" strokeWidth={3} />}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-between gap-3 min-w-0">{conteudo}</div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de ações em massa e PDF */}
      {modal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-slate-100 flex items-start justify-between">
              <div>
                <h3 className="font-bold text-slate-900">
                  {resultado
                    ? "Resultado"
                    : modal === "pdf"
                    ? "Baixar PDF dos Empréstimos"
                    : modal === "menu"
                    ? "Alterar em massa"
                    : acaoAtual?.titulo}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selecionados.size} de {emprestimos.length} empréstimo{emprestimos.length !== 1 ? "s" : ""} selecionado{selecionados.size !== 1 ? "s" : ""} · {formatBRL(totalSelecionado)}
                </p>
              </div>
              <button
                onClick={fecharModal}
                disabled={isPending || !!isGeneratingPdf}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* Resultado */}
              {resultado ? (
                <>
                  {(() => {
                    const ok = resultado.itens.filter((i) => i.status === "ok").length;
                    const prob = resultado.itens.filter((i) => i.status !== "ok");
                    return (
                      <>
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-xl p-3">
                          <CheckCircle2 className="w-5 h-5 shrink-0" />
                          {ok} de {resultado.itens.length} concluído{ok !== 1 ? "s" : ""} com sucesso
                        </div>
                        {prob.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Não aplicado</p>
                            {prob.map((i) => (
                              <div key={i.id} className="text-xs bg-amber-50 text-amber-800 rounded-xl p-3">
                                <div className="font-bold">{rotuloItem(i.id)}</div>
                                <div>{i.mensagem}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <button
                    onClick={fecharModal}
                    className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 cursor-pointer"
                  >
                    Fechar
                  </button>
                </>
              ) : modal === "pdf" ? (
                /* Modal de Baixar / Enviar PDF dos Empréstimos Selecionados */
                <>
                  {/* Seleção rápida de quais empréstimos ou todos */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Escolher empréstimos para o PDF
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={selecionarTodos}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                            todosSelecionados
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          Todos ({emprestimos.length})
                        </button>
                        {emprestimosEmAberto.length > 0 &&
                          emprestimosEmAberto.length < emprestimos.length && (
                            <button
                              type="button"
                              onClick={selecionarApenasEmAberto}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
                            >
                              Só em aberto ({emprestimosEmAberto.length})
                            </button>
                          )}
                        {selecionados.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelecionados(new Set())}
                            className="px-2 py-1 rounded-lg text-[11px] font-semibold text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Lista compacta com checkboxes para marcar/desmarcar qualquer empréstimo */}
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-slate-50/40">
                      {emprestimos.map((emp, idx) => {
                        const marcado = selecionados.has(emp.id);
                        const badge = badgeClasses[emp.situacao];
                        return (
                          <div
                            key={emp.id}
                            onClick={() => {
                              setPdfFeedback(null);
                              setErro(null);
                              alternar(emp.id);
                            }}
                            className={`px-3 py-2.5 flex items-center justify-between gap-2.5 cursor-pointer select-none transition-colors ${
                              marcado ? "bg-emerald-50/80" : "hover:bg-slate-100/70"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                                  marcado
                                    ? "bg-emerald-600 border-emerald-600 text-white"
                                    : "bg-white border-slate-300"
                                }`}
                              >
                                {marcado && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-bold text-slate-900">
                                    #{idx + 1} · Venc. {emp.vencimento}
                                  </span>
                                  <span
                                    className={`${badge.cls} text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase`}
                                  >
                                    {badge.label}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  Juros: {emp.taxaJuros}% ({formatBRL(emp.valorJuros)})
                                </div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-bold text-slate-900">
                                {formatBRL(emp.principal)} →{" "}
                                <span className="text-emerald-600">{formatBRL(emp.total)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Resumo financeiro dos selecionados */}
                  <div className="p-3.5 bg-slate-900 text-white rounded-2xl space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span>Capital emprestado ({itensSelecionados.length}):</span>
                      <span className="font-semibold text-white">{formatBRL(capitalSelecionado)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-300">
                      <span>Juros totais:</span>
                      <span className="font-semibold text-white">{formatBRL(jurosSelecionado)}</span>
                    </div>
                    <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                        Total no PDF:
                      </span>
                      <span className="text-base font-black text-emerald-400">
                        {formatBRL(totalSelecionado)}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    O PDF será gerado com quadro de visão geral e cada empréstimo separado e explicado individualmente.
                  </p>

                  {erro && (
                    <div className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                      {erro}
                    </div>
                  )}

                  {pdfFeedback && (
                    <div
                      className={`text-xs font-semibold rounded-xl p-3 flex items-start gap-2 ${
                        pdfFeedback.tipo === "sucesso"
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                          : pdfFeedback.tipo === "aviso"
                          ? "bg-amber-50 text-amber-800 border border-amber-200"
                          : "bg-rose-50 text-rose-800 border border-rose-200"
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{pdfFeedback.texto}</span>
                    </div>
                  )}

                  {/* Duas opções de ação: Só baixar OU Baixar e enviar para o cliente */}
                  <div className="space-y-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleSoBaixarPdf}
                      disabled={itensSelecionados.length === 0 || !!isGeneratingPdf}
                      className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {isGeneratingPdf === "baixar" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileDown className="w-4 h-4" />
                      )}
                      <span>
                        {isGeneratingPdf === "baixar"
                          ? "Gerando PDF..."
                          : `Só baixar PDF (${itensSelecionados.length})`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleBaixarEEnviarPdf}
                      disabled={itensSelecionados.length === 0 || !!isGeneratingPdf}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {isGeneratingPdf === "enviar" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      <span>
                        {isGeneratingPdf === "enviar"
                          ? "Baixando e enviando no WhatsApp..."
                          : `Baixar e enviar para o cliente (${itensSelecionados.length})`}
                      </span>
                    </button>
                  </div>
                </>
              ) : modal === "menu" ? (
                /* Escolha da ação */
                <div className="space-y-2">
                  {acoes.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => { setErro(null); setModal(a.id); }}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                    >
                      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.cor}`}>
                        {a.icone}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-slate-900">{a.titulo}</span>
                        <span className="block text-xs text-slate-500">{a.descricao}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  ))}

                  <button
                    onClick={() => { setErro(null); setPdfFeedback(null); setModal("pdf"); }}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left cursor-pointer"
                  >
                    <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-slate-700 bg-slate-100">
                      <FileDown className="w-5 h-5" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-slate-900">Baixar / Enviar PDF</span>
                      <span className="block text-xs text-slate-500">
                        Gera o demonstrativo em PDF para baixar ou enviar no WhatsApp do cliente.
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </div>
              ) : acaoAtual ? (
                /* Confirmação da ação */
                <>
                  <p className="text-sm text-slate-600">{acaoAtual.descricao}</p>

                  {acaoAtual.id === "reprogramar" && (
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                        Nova data de vencimento
                      </label>
                      <input
                        type="date"
                        value={novaData}
                        onChange={(e) => setNovaData(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-slate-400 mt-1">
                        Todos os selecionados passam a vencer nesta data.
                      </p>
                    </div>
                  )}

                  {acaoAtual.id === "quitar" && (
                    <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cobrarJuros}
                        onChange={(e) => setCobrarJuros(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-emerald-600"
                      />
                      <span>
                        Cobrar juros de atraso
                        <span className="block text-xs text-slate-400">
                          Conforme a regra de cada empréstimo. Desmarque para perdoar os juros.
                        </span>
                      </span>
                    </label>
                  )}

                  {acaoAtual.id === "excluir" && (
                    <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 rounded-xl p-3">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span>Os empréstimos e suas parcelas serão apagados definitivamente.</span>
                    </div>
                  )}

                  <p className="text-xs text-slate-400">
                    Nenhuma mensagem de WhatsApp é enviada nas ações em massa.
                  </p>

                  {erro && (
                    <div className="text-sm text-rose-700 bg-rose-50 rounded-xl p-3">{erro}</div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setErro(null); setModal("menu"); }}
                      disabled={isPending}
                      className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={() => confirmar(acaoAtual.id)}
                      disabled={isPending}
                      className={`flex-1 py-3 rounded-xl text-white text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer ${acaoAtual.botao}`}
                    >
                      {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                      {isPending ? "Aplicando..." : `${acaoAtual.titulo} ${selecionados.size}`}
                    </button>
                  </div>
                </>
              ) : null}

              {modal === "menu" && erro && (
                <div className="text-sm text-rose-700 bg-rose-50 rounded-xl p-3">{erro}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

