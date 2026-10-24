/**
 * Tipos, temas de cor e formatadores compartilhados pela tela de Cobranças.
 * (Sem "use client": são funções puras.)
 */
import { normalizarTelefone } from "@/lib/mensagens/render";

export type TipoAcaoEmprestimo =
  | "renovar"
  | "quitar"
  | "pagar_parcela"
  | "reprogramar"
  | "renegociar"
  | "data_prevista"
  | "pausar";

export interface Parcela {
  id: string;
  numero: number;
  valor: number;
  data_vencimento: string;
  status: string;
  /** Texto final da cobrança (modelo editável + rodapé), renderizado no servidor. */
  mensagem: string;
  /** Dias de atraso: > 0 atrasada, 0 vence hoje, < 0 faltam N dias. Calculado no servidor (Brasília). */
  diasAtraso: number;
  /** ISO da última cobrança enviada (ou null). */
  ultimaCobranca: string | null;
  emprestimo: {
    id: string;
    valor_emprestado: number;
    taxa_juros: number;
    tipo_pagamento: string;
    frequencia: string;
    totalParcelas: number;
    parcelasAbertasCount: number;
    saldoRestante: number;
    atraso_tipo: string | null;
    atraso_valor: number | null;
    data_prevista_pagamento: string | null;
    cliente: {
      id: string;
      nome: string;
      telefone: string;
    };
  };
}

export type TipoCobranca = "atrasados" | "hoje" | "aVencer";
export type TabId = "atrasados" | "ontem" | "anteriores" | "hoje" | "aVencer" | "carencia_10";
export type CorTema = "rose" | "orange" | "red" | "amber" | "emerald";

/**
 * Classes completas (literais) para o Tailwind enxergar cada uma.
 * Mesma paleta das abas: rose / orange / red / amber / emerald, sobre base slate.
 */
export interface Tema {
  dot: string;
  title: string;
  pill: string;
  headBorder: string;
  accent: string;
  selectedBg: string;
  chip: string;
  soft: string;
  massBtn: string;
  ring: string;
  progress: string;
}

export const TEMAS: Record<CorTema, Tema> = {
  rose: {
    dot: "bg-rose-500",
    title: "text-rose-600",
    pill: "bg-rose-50 text-rose-600 border border-rose-200",
    headBorder: "border-rose-500/20",
    accent: "accent-rose-500",
    selectedBg: "bg-rose-50/60",
    chip: "bg-rose-50 text-rose-600 border-rose-200",
    soft: "bg-rose-50 text-rose-600",
    massBtn: "bg-rose-500 hover:bg-rose-600 shadow-rose-500/25",
    ring: "focus:ring-rose-500/20 focus:border-rose-300",
    progress: "bg-rose-500",
  },
  orange: {
    dot: "bg-orange-500",
    title: "text-orange-600",
    pill: "bg-orange-50 text-orange-600 border border-orange-200",
    headBorder: "border-orange-500/20",
    accent: "accent-orange-500",
    selectedBg: "bg-orange-50/60",
    chip: "bg-orange-50 text-orange-600 border-orange-200",
    soft: "bg-orange-50 text-orange-600",
    massBtn: "bg-orange-500 hover:bg-orange-600 shadow-orange-500/25",
    ring: "focus:ring-orange-500/20 focus:border-orange-300",
    progress: "bg-orange-500",
  },
  red: {
    dot: "bg-red-600",
    title: "text-red-700",
    pill: "bg-red-50 text-red-600 border border-red-200",
    headBorder: "border-red-500/20",
    accent: "accent-red-600",
    selectedBg: "bg-red-50/60",
    chip: "bg-red-50 text-red-600 border-red-200",
    soft: "bg-red-50 text-red-600",
    massBtn: "bg-red-600 hover:bg-red-700 shadow-red-600/25",
    ring: "focus:ring-red-500/20 focus:border-red-300",
    progress: "bg-red-600",
  },
  amber: {
    dot: "bg-amber-500",
    title: "text-amber-600",
    pill: "bg-amber-50 text-amber-600 border border-amber-200",
    headBorder: "border-amber-500/20",
    accent: "accent-amber-500",
    selectedBg: "bg-amber-50/60",
    chip: "bg-amber-50 text-amber-600 border-amber-200",
    soft: "bg-amber-50 text-amber-600",
    massBtn: "bg-amber-500 hover:bg-amber-600 shadow-amber-500/25",
    ring: "focus:ring-amber-500/20 focus:border-amber-300",
    progress: "bg-amber-500",
  },
  emerald: {
    dot: "bg-emerald-500",
    title: "text-emerald-600",
    pill: "bg-emerald-50 text-emerald-600 border border-emerald-200",
    headBorder: "border-emerald-500/20",
    accent: "accent-emerald-500",
    selectedBg: "bg-emerald-50/60",
    chip: "bg-emerald-50 text-emerald-600 border-emerald-200",
    soft: "bg-emerald-50 text-emerald-600",
    massBtn: "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25",
    ring: "focus:ring-emerald-500/20 focus:border-emerald-300",
    progress: "bg-emerald-600",
  },
};

// ───────────────────────────── Formatadores ─────────────────────────────

export const formatBRL = (val: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

export const formatData = (dateStr: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateStr));

/** 14996209341 → (14) 99620-9341. Se não reconhecer o formato, devolve como veio. */
export function formatTelefone(telefone: string): string {
  let d = (telefone || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return telefone;
}

/** Telefone em formato de link tel: (+55…). */
export const telLink = (telefone: string) => `tel:+${normalizarTelefone(telefone)}`;

const TZ = "America/Sao_Paulo";

/** Chave AAAA-MM-DD de um instante, no fuso de Brasília. */
function diaBrasilia(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** "hoje às 14:32" · "ontem às 09:10" · "há 3 dias" · "há 2 meses" (fuso de Brasília). */
export function tempoRelativo(iso: string, agora: Date = new Date()): string {
  const quando = new Date(iso);
  const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(quando);
  const dias = Math.round(
    (Date.parse(diaBrasilia(agora)) - Date.parse(diaBrasilia(quando))) / 86_400_000
  );
  if (dias <= 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
}

export const ehHoje = (iso: string, agora: Date = new Date()) =>
  diaBrasilia(new Date(iso)) === diaBrasilia(agora);

// ───────────────────────────── Severidade ─────────────────────────────

export interface Severidade {
  texto: string;
  /** Classes do selo de status. */
  badge: string;
  /** Cor da barra lateral da linha. */
  barra: string;
}

/** Gradiente de urgência: verde (a vencer) → âmbar (hoje) → laranja → vermelho → vermelho forte. */
export function severidade(dias: number, modoCarencia = false, modoCarencia10 = false): Severidade {
  if (dias < 0) {
    const n = -dias;
    return {
      texto: `Vence em ${n} ${n === 1 ? "dia" : "dias"}`,
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      barra: "bg-emerald-400",
    };
  }
  if (dias === 0) {
    return { texto: "Vence hoje", badge: "bg-amber-50 text-amber-700 border-amber-200", barra: "bg-amber-400" };
  }
  if (modoCarencia10) {
    if (dias <= 2) {
      return {
        texto: `Hoje (${dias} ${dias === 1 ? "dia" : "dias"})`,
        badge: "bg-amber-50 text-amber-700 border-amber-200",
        barra: "bg-amber-400",
      };
    }
    if (dias <= 10) {
      return {
        texto: `${dias} dias de carência`,
        badge: "bg-orange-50 text-orange-800 border-orange-200",
        barra: "bg-orange-400",
      };
    }
    return {
      texto: `${dias} dias de atraso`,
      badge: "bg-red-600 text-white border-red-600",
      barra: "bg-red-700",
    };
  }
  if (modoCarencia) {
    if (dias <= 30) {
      return {
        texto: `${dias} ${dias === 1 ? "dia" : "dias"} de carência`,
        badge: "bg-amber-50 text-amber-800 border-amber-200",
        barra: "bg-amber-400",
      };
    }
    return {
      texto: `${dias} dias de atraso (+30d carência)`,
      badge: "bg-red-600 text-white border-red-600",
      barra: "bg-red-700",
    };
  }
  const texto = `${dias} ${dias === 1 ? "dia" : "dias"} de atraso`;
  if (dias <= 7) return { texto, badge: "bg-orange-50 text-orange-700 border-orange-200", barra: "bg-orange-400" };
  if (dias <= 30) return { texto, badge: "bg-red-50 text-red-700 border-red-200", barra: "bg-red-500" };
  return { texto, badge: "bg-red-600 text-white border-red-600", barra: "bg-red-700" };
}

/** Parcela única / à vista (empréstimos parcelados nunca possuem renovação). */
export function isParcelaUnica(p: Parcela): boolean {
  if (
    p.emprestimo.tipo_pagamento === "parcelado" ||
    p.emprestimo.tipo_pagamento === "parcela_juros_mes" ||
    p.emprestimo.parcelasAbertasCount > 1
  ) {
    return false;
  }
  return (
    p.emprestimo.totalParcelas <= 1 ||
    p.emprestimo.tipo_pagamento === "a_vista" ||
    p.emprestimo.tipo_pagamento === "a_vista_juros" ||
    p.emprestimo.tipo_pagamento === "juros_compostos"
  );
}
