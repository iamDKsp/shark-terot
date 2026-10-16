"use client";

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Layers,
  MessageCircle,
  MoreHorizontal,
  PauseCircle,
  Phone,
  RefreshCw,
  TrendingUp,
  User,
  Wallet,
} from "lucide-react";
import { linkWhatsapp } from "@/lib/mensagens/render";
import {
  formatBRL,
  formatData,
  formatTelefone,
  isParcelaUnica,
  severidade,
  telLink,
  tempoRelativo,
  type Parcela,
  type Tema,
  type TipoAcaoEmprestimo,
  type TipoCobranca,
} from "./tipos";

interface ParcelaRowProps {
  p: Parcela;
  /** Posição na lista — usada só para escalonar a animação de entrada. */
  index: number;
  tema: Tema;
  tipo: TipoCobranca;
  selecionado: boolean;
  cobradoHoje: boolean;
  /** ISO da última cobrança (inclui as feitas nesta sessão). */
  ultimoEnvio: string | null;
  onToggle: (id: string, checked: boolean) => void;
  onCobrar: (p: Parcela, tipo: TipoCobranca) => void;
  onCopiar: (p: Parcela) => void;
  onAcaoEmprestimo: (p: Parcela, acao: TipoAcaoEmprestimo) => void;
  modoCarencia?: boolean;
  /** Quando renderizado dentro de um grupo expandido. */
  sub?: boolean;
}

/** Selo de severidade + situação da cobrança. */
function StatusBlock({ p, cobradoHoje, ultimoEnvio, modoCarencia }: { p: Parcela; cobradoHoje: boolean; ultimoEnvio: string | null; modoCarencia?: boolean }) {
  const sev = severidade(p.diasAtraso, modoCarencia);
  const textoCobranca = ultimoEnvio ? `Cobrado ${tempoRelativo(ultimoEnvio)}` : cobradoHoje ? "Cobrado hoje" : "Ainda não cobrado";
  return (
    <>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border ${sev.badge}`}>
        {sev.texto}
      </span>
      {cobradoHoje ? (
        <span
          key="cobrado"
          suppressHydrationWarning
          className="animate-pop inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black border bg-emerald-50 text-emerald-700 border-emerald-200"
        >
          <Check className="w-3 h-3" strokeWidth={3} />
          {textoCobranca}
        </span>
      ) : (
        <span suppressHydrationWarning className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
          <Clock className="w-3 h-3" />
          {textoCobranca}
        </span>
      )}
    </>
  );
}

/** Menu "⋯" — usa position: fixed para nunca ser cortado pelo cartão da lista. */
function MenuLinha({
  p,
  onCopiar,
  onAcaoEmprestimo,
}: {
  p: Parcela;
  onCopiar: (p: Parcela) => void;
  onAcaoEmprestimo: (p: Parcela, acao: TipoAcaoEmprestimo) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fechar = () => setAberto(false);
    const aoClicarFora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!menuRef.current?.contains(alvo) && !btnRef.current?.contains(alvo)) fechar();
    };
    const aoRolar = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      fechar();
    };
    const aoTecla = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    document.addEventListener("pointerdown", aoClicarFora);
    document.addEventListener("keydown", aoTecla);
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("pointerdown", aoClicarFora);
      document.removeEventListener("keydown", aoTecla);
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  const alternar = () => {
    if (aberto) return setAberto(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const espacoAbaixo = window.innerHeight - r.bottom;
    const abreParaCima = espacoAbaixo < 360 && r.top > espacoAbaixo;
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      ...(abreParaCima ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
    setAberto(true);
  };

  const disparar = (acao: TipoAcaoEmprestimo) => {
    setAberto(false);
    onAcaoEmprestimo(p, acao);
  };

  const aVista = isParcelaUnica(p);
  const podeRenovar = aVista && p.emprestimo.taxa_juros > 0;
  const multiplasAbertas = !aVista && p.emprestimo.parcelasAbertasCount > 1 && !p.id.startsWith("legacy-");
  const valorJuros = p.emprestimo.valor_emprestado * (p.emprestimo.taxa_juros / 100);

  const itemCls =
    "w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-emerald-700 transition-colors cursor-pointer text-left";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={alternar}
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={`btn-press h-9 w-9 flex-shrink-0 inline-flex items-center justify-center rounded-xl border text-slate-500 cursor-pointer ${
          aberto ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-700"
        }`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {aberto && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
          className="animate-drop-in fixed z-[45] w-60 max-h-[80vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-900/10 divide-y divide-slate-100"
        >
          {/* Seção 1: Ações rápidas do empréstimo */}
          <div className="py-1">
            <div className="px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
              Ações do Empréstimo
            </div>

            {podeRenovar && (
              <button role="menuitem" type="button" onClick={() => disparar("renovar")} className={itemCls}>
                <RefreshCw className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 truncate">Renovação (+30d)</span>
                <span className="text-[10px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md tabular-nums">
                  {formatBRL(valorJuros)}
                </span>
              </button>
            )}

            {multiplasAbertas && (
              <button role="menuitem" type="button" onClick={() => disparar("pagar_parcela")} className={itemCls}>
                <Wallet className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="flex-1 truncate">Pagar Parcela {p.numero}</span>
                <span className="text-[10px] font-bold text-slate-500 tabular-nums">{formatBRL(p.valor)}</span>
              </button>
            )}

            <button role="menuitem" type="button" onClick={() => disparar("quitar")} className={itemCls}>
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="flex-1 truncate">
                {multiplasAbertas ? "Quitar Tudo" : "Quitar"}
              </span>
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md tabular-nums">
                {formatBRL(p.emprestimo.saldoRestante)}
              </span>
            </button>

            <button role="menuitem" type="button" onClick={() => disparar("reprogramar")} className={itemCls}>
              <CalendarClock className="w-4 h-4 text-blue-500 shrink-0" />
              <span>Reprogramar</span>
            </button>

            <button role="menuitem" type="button" onClick={() => disparar("renegociar")} className={itemCls}>
              <TrendingUp className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>Renegociar / Abater</span>
            </button>

            <button role="menuitem" type="button" onClick={() => disparar("data_prevista")} className={itemCls}>
              <Calendar className="w-4 h-4 text-amber-500 shrink-0" />
              <span>{p.emprestimo.data_prevista_pagamento ? "Editar data prevista" : "Definir data prevista"}</span>
            </button>

            <button role="menuitem" type="button" onClick={() => disparar("pausar")} className={itemCls}>
              <PauseCircle className="w-4 h-4 text-yellow-600 shrink-0" />
              <span>Pausar (Acordo)</span>
            </button>
          </div>

          {/* Seção 2: Contato & Cliente */}
          <div className="py-1">
            <Link role="menuitem" href={`/clientes/${p.emprestimo.cliente.id}`} className={itemCls}>
              <User className="w-4 h-4 text-slate-400 shrink-0" /> Ver cliente
            </Link>
            <a role="menuitem" href={telLink(p.emprestimo.cliente.telefone)} onClick={() => setAberto(false)} className={itemCls}>
              <Phone className="w-4 h-4 text-slate-400 shrink-0" /> Ligar
            </a>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                onCopiar(p);
                setAberto(false);
              }}
              className={itemCls}
            >
              <Copy className="w-4 h-4 text-slate-400 shrink-0" /> Copiar mensagem
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ParcelaRowBase({ p, index, tema, tipo, selecionado, cobradoHoje, ultimoEnvio, onToggle, onCobrar, onCopiar, onAcaoEmprestimo, modoCarencia, sub = false }: ParcelaRowProps) {
  const cliente = p.emprestimo.cliente;
  const sev = severidade(p.diasAtraso, modoCarencia);
  const semTelefone = !cliente.telefone?.replace(/\D/g, "");
  const totalLabel = isParcelaUnica(p) ? "À Vista" : `Parc. ${p.numero}/${p.emprestimo.totalParcelas}`;

  return (
    <div
      style={{ ["--i" as string]: Math.min(index, 12) }}
      className={`${sub ? "" : "animate-row-in"} group relative grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_13rem_7.5rem_11.5rem] xl:grid-cols-[auto_minmax(0,1fr)_13rem_7.5rem_16.5rem] items-center gap-x-3 gap-y-2.5 pl-4 pr-3 sm:pr-4 py-3 transition-colors duration-200 ${
        selecionado ? tema.selectedBg : "hover:bg-slate-50/70"
      }`}
    >
      {/* Barra lateral de urgência */}
      <span aria-hidden className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full transition-all duration-300 group-hover:top-1 group-hover:bottom-1 ${sev.barra}`} />

      <input
        type="checkbox"
        checked={selecionado}
        onChange={(e) => onToggle(p.id, e.target.checked)}
        aria-label={`Selecionar ${cliente.nome}`}
        className={`w-[18px] h-[18px] rounded border-slate-300 cursor-pointer flex-shrink-0 ${tema.accent}`}
      />

      {/* Cliente */}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link
            href={`/clientes/${cliente.id}`}
            title="Abrir perfil do cliente"
            className="font-bold text-sm text-slate-900 truncate hover:text-emerald-700 hover:underline underline-offset-2 decoration-emerald-300 transition-colors"
          >
            {cliente.nome}
          </Link>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${tema.chip}`}>{totalLabel}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
          <span className="flex items-center gap-0.5">
            <Calendar className="w-3 h-3" />
            {formatData(p.data_vencimento)}
          </span>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums">{formatTelefone(cliente.telefone)}</span>
        </div>
        {/* Status — versão celular (no desktop vira coluna própria) */}
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap md:hidden">
          <StatusBlock p={p} cobradoHoje={cobradoHoje} ultimoEnvio={ultimoEnvio} modoCarencia={modoCarencia} />
        </div>
        {p.emprestimo.data_prevista_pagamento && (
          <div className="mt-1 flex items-center gap-1">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-[9px] font-black text-amber-700">
              <CalendarClock className="w-3 h-3" />
              Previsto: {formatData(p.emprestimo.data_prevista_pagamento)}
            </span>
          </div>
        )}
      </div>

      {/* Status — versão desktop */}
      <div className="hidden md:flex flex-col items-start gap-1.5">
        <StatusBlock p={p} cobradoHoje={cobradoHoje} ultimoEnvio={ultimoEnvio} modoCarencia={modoCarencia} />
      </div>

      {/* Valor */}
      <span className="text-sm font-black text-slate-900 tabular-nums text-right">{formatBRL(p.valor)}</span>

      {/* Ações: no celular ocupam a 2ª linha, com Cobrar em largura total */}
      <div className="col-start-2 col-span-2 md:col-start-auto md:col-span-1 flex items-center gap-2 md:justify-end">
        {semTelefone ? (
          <span
            title="Cliente sem telefone cadastrado"
            className="flex-1 md:flex-none h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold cursor-not-allowed"
          >
            <MessageCircle className="w-4 h-4" /> Sem telefone
          </span>
        ) : (
          <a
            href={linkWhatsapp(cliente.telefone, p.mensagem)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onCobrar(p, tipo)}
            className={`btn-press flex-1 md:flex-none h-9 px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs font-bold cursor-pointer ${
              cobradoHoje
                ? "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-600 hover:text-white hover:border-emerald-600"
                : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-600/25 hover:shadow-md hover:shadow-emerald-600/30"
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            {cobradoHoje ? "Cobrar de novo" : "Cobrar"}
          </a>
        )}

        <Link
          href={`/emprestimos/${p.emprestimo.id}`}
          title="Abrir empréstimo"
          className="btn-press h-9 px-3 flex-shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span className="hidden sm:inline md:hidden xl:inline">Empréstimo</span>
        </Link>

        <MenuLinha p={p} onCopiar={onCopiar} onAcaoEmprestimo={onAcaoEmprestimo} />
      </div>
    </div>
  );
}

/** memo: marcar uma linha não re-renderiza as outras ~90. */
const ParcelaRow = memo(ParcelaRowBase);
export default ParcelaRow;

// ───────────────────────────── Linha Agrupada (2+ parcelas do mesmo cliente) ─────────────────────────────

interface GrupoParcelaRowProps {
  clienteId: string;
  parcelas: Parcela[];
  index: number;
  aberto: boolean;
  tema: Tema;
  tipo: TipoCobranca;
  selecionados: Set<string>;
  cobradas: Set<string>;
  ultimoEnvioMap: Record<string, string>;
  onToggleExpand: (clienteId: string) => void;
  onToggleParcela: (id: string, checked: boolean) => void;
  onToggleGrupo: (ids: string[], checked: boolean) => void;
  onCobrar: (p: Parcela, tipo: TipoCobranca) => void;
  onCopiar: (p: Parcela) => void;
  onAcaoEmprestimo: (p: Parcela, acao: TipoAcaoEmprestimo) => void;
  modoCarencia?: boolean;
}

export function GrupoParcelaRow({
  clienteId,
  parcelas,
  index,
  aberto,
  tema,
  tipo,
  selecionados,
  cobradas,
  ultimoEnvioMap,
  onToggleExpand,
  onToggleParcela,
  onToggleGrupo,
  onCobrar,
  onCopiar,
  onAcaoEmprestimo,
  modoCarencia,
}: GrupoParcelaRowProps) {
  const cliente = parcelas[0].emprestimo.cliente;
  const ids = parcelas.map((p) => p.id);
  const qtdSelecionadas = parcelas.filter((p) => selecionados.has(p.id)).length;
  const todasSelecionadas = qtdSelecionadas === parcelas.length;
  const algumaSelecionada = qtdSelecionadas > 0 && !todasSelecionadas;

  const maiorDiasAtraso = parcelas.reduce((max, p) => Math.max(max, p.diasAtraso), parcelas[0].diasAtraso);
  const sev = severidade(maiorDiasAtraso, modoCarencia);

  const totalGrupo = parcelas.reduce((acc, p) => acc + p.valor, 0);
  const vencMaisAntigo = parcelas.reduce(
    (min, p) => (new Date(p.data_vencimento).getTime() < new Date(min).getTime() ? p.data_vencimento : min),
    parcelas[0].data_vencimento
  );

  const qtdCobradasHoje = parcelas.filter((p) => cobradas.has(p.id)).length;
  const todasCobradasHoje = qtdCobradasHoje === parcelas.length;

  // Último envio mais recente entre as parcelas do grupo
  const ultimoEnvioGrupo = parcelas.reduce<string | null>((latest, p) => {
    const env = ultimoEnvioMap[p.id] ?? p.ultimaCobranca;
    if (!env) return latest;
    if (!latest) return env;
    return new Date(env).getTime() > new Date(latest).getTime() ? env : latest;
  }, null);

  const textoCobrancaGrupo = todasCobradasHoje
    ? ultimoEnvioGrupo
      ? `Cobrado ${tempoRelativo(ultimoEnvioGrupo)}`
      : "Cobrado hoje"
    : qtdCobradasHoje > 0
      ? `${qtdCobradasHoje}/${parcelas.length} cobradas hoje`
      : ultimoEnvioGrupo
        ? `Cobrado ${tempoRelativo(ultimoEnvioGrupo)}`
        : "Ainda não cobrado";

  const statusGrupoBlock = (
    <>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border ${sev.badge}`}>
        {sev.texto}
      </span>
      {qtdCobradasHoje > 0 ? (
        <span
          suppressHydrationWarning
          className="animate-pop inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black border bg-emerald-50 text-emerald-700 border-emerald-200"
        >
          <Check className="w-3 h-3" strokeWidth={3} />
          {textoCobrancaGrupo}
        </span>
      ) : (
        <span suppressHydrationWarning className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
          <Clock className="w-3 h-3" />
          {textoCobrancaGrupo}
        </span>
      )}
    </>
  );

  return (
    <div style={{ ["--i" as string]: Math.min(index, 12) }} className="animate-row-in">
      {/* Cabeçalho do grupo (clicável para expandir/recolher, igual ao módulo Empréstimos) */}
      <div
        onClick={() => onToggleExpand(clienteId)}
        className={`group relative grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_13rem_7.5rem_11.5rem] xl:grid-cols-[auto_minmax(0,1fr)_13rem_7.5rem_16.5rem] items-center gap-x-3 gap-y-2.5 pl-4 pr-3 sm:pr-4 py-3.5 transition-colors duration-200 cursor-pointer ${
          todasSelecionadas ? tema.selectedBg : aberto ? "bg-slate-50/80" : "hover:bg-slate-50/70"
        }`}
      >
        {/* Barra lateral de urgência */}
        <span aria-hidden className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full transition-all duration-300 group-hover:top-1 group-hover:bottom-1 ${sev.barra}`} />

        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = algumaSelecionada;
          }}
          checked={todasSelecionadas}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleGrupo(ids, e.target.checked)}
          aria-label={`Selecionar todas as ${parcelas.length} parcelas de ${cliente.nome}`}
          className={`w-[18px] h-[18px] rounded border-slate-300 cursor-pointer flex-shrink-0 ${tema.accent}`}
        />

        {/* Cliente + Selo de Agrupamento */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-sm text-slate-900 truncate">{cliente.nome}</span>
            <span className="inline-flex items-center gap-1 bg-slate-800 text-white text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
              <Layers className="w-3 h-3" /> {parcelas.length} parcelas
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
            <span className="flex items-center gap-0.5">
              <Calendar className="w-3 h-3" />
              Mais antigo: {formatData(vencMaisAntigo)}
            </span>
            <span className="text-slate-300">·</span>
            <span className="tabular-nums">{formatTelefone(cliente.telefone)}</span>
          </div>
          {/* Status — versão celular */}
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap md:hidden">
            {statusGrupoBlock}
          </div>
        </div>

        {/* Status — versão desktop */}
        <div className="hidden md:flex flex-col items-start gap-1.5">
          {statusGrupoBlock}
        </div>

        {/* Valor Total do Grupo */}
        <div className="text-right">
          <div className="text-sm font-black text-slate-900 tabular-nums">{formatBRL(totalGrupo)}</div>
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total</div>
        </div>

        {/* Botão de expandir/recolher subparcelas */}
        <div className="col-start-2 col-span-2 md:col-start-auto md:col-span-1 flex items-center justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(clienteId);
            }}
            title={aberto ? "Fechar parcelas do cliente" : "Ver parcelas do cliente"}
            aria-expanded={aberto}
            className={`w-full md:w-auto py-2 px-3 md:p-2.5 rounded-xl transition-all shadow-sm shrink-0 active:scale-95 md:active:scale-90 cursor-pointer inline-flex items-center justify-center gap-1.5 text-xs font-bold ${
              aberto ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 md:text-slate-500 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <span className="md:hidden">{aberto ? "Recolher parcelas" : `Ver ${parcelas.length} parcelas`}</span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Subparcelas expandidas (mesma animação e indentação do módulo Empréstimos) */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          aberto ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
        }`}
      >
        <div className="overflow-hidden">
          <div className="ml-4 md:ml-8 mr-2 sm:mr-4 mb-3 pl-3 md:pl-5 border-l-2 border-slate-200 space-y-2 pt-1">
            {parcelas.map((p, idx) => (
              <div key={p.id} className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
                <ParcelaRow
                  p={p}
                  index={idx}
                  tema={tema}
                  tipo={tipo}
                  selecionado={selecionados.has(p.id)}
                  cobradoHoje={cobradas.has(p.id)}
                  ultimoEnvio={ultimoEnvioMap[p.id] ?? p.ultimaCobranca}
                  onToggle={onToggleParcela}
                  onCobrar={onCobrar}
                  onCopiar={onCopiar}
                  onAcaoEmprestimo={onAcaoEmprestimo}
                  modoCarencia={modoCarencia}
                  sub
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

