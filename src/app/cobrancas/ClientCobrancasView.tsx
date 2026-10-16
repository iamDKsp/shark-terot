"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUrlState } from "@/hooks/useUrlState";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import {
  AlertCircle,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Flame,
  Search,
  Send,
  Settings,
  SearchX,
  Users,
  X,
} from "lucide-react";
import { registrarCobrancaManual } from "./actions";
import ParcelaRow, { GrupoParcelaRow } from "./ParcelaRow";
import DisparoModal from "./DisparoModal";
import AcaoEmprestimoModal from "./AcaoEmprestimoModal";
import { TEMAS, formatBRL, type CorTema, type Parcela, type TabId, type TipoAcaoEmprestimo, type TipoCobranca } from "./tipos";

interface ClientCobrancasViewProps {
  atrasadosOntem: Parcela[];
  atrasadosAnteriores: Parcela[];
  hojeLista: Parcela[];
  aVencer: Parcela[];
  initialFiltro?: string;
  /** Ids de parcelas que já receberam cobrança hoje. */
  cobradasHoje: string[];
  /** false = chave Pix não cadastrada (rodapé de pagamento não é enviado). */
  pixConfigurado: boolean;
  modoCarencia?: boolean;
  modoCarencia10?: boolean;
}

type Ordem = "vencimento" | "valor" | "nome";

const ORDENS: { id: Ordem; label: string }[] = [
  { id: "vencimento", label: "Mais antigos primeiro" },
  { id: "valor", label: "Maior valor" },
  { id: "nome", label: "Nome (A–Z)" },
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function ClientCobrancasView({ atrasadosOntem, atrasadosAnteriores, hojeLista, aVencer, initialFiltro, cobradasHoje, pixConfigurado, modoCarencia = false, modoCarencia10 = false }: ClientCobrancasViewProps) {
  const router = useRouter();
  // Combina ontem + anteriores para a aba "Todos"
  const atrasados = useMemo(
    () =>
      [...atrasadosOntem, ...atrasadosAnteriores].sort(
        (a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime()
      ),
    [atrasadosOntem, atrasadosAnteriores]
  );

  // Listas da Regra de Carência de 10 Dias (1 e 2 = hoje | 2 a 10 = 10d carência | 10+ = atrasados)
  const hojeCarencia10 = useMemo(
    () =>
      [...hojeLista, ...atrasadosOntem, ...atrasadosAnteriores.filter((p) => p.diasAtraso <= 2)].sort(
        (a, b) => new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime()
      ),
    [hojeLista, atrasadosOntem, atrasadosAnteriores]
  );

  const carencia10Lista = useMemo(
    () => atrasadosAnteriores.filter((p) => p.diasAtraso > 2 && p.diasAtraso <= 10),
    [atrasadosAnteriores]
  );

  const atrasados10Lista = useMemo(
    () => atrasadosAnteriores.filter((p) => p.diasAtraso > 10),
    [atrasadosAnteriores]
  );

  // Resolve aba inicial a partir do filtro da URL
  const resolveTab = (f?: string): TabId => {
    if (modoCarencia10) {
      if (f === "carencia_10" || f === "carencia") return "carencia_10";
      if (f === "atrasados" || f === "anteriores") return "atrasados";
      if (f === "aVencer") return "aVencer";
      if (f === "hoje" || f === "ontem") return "hoje";
      return "hoje";
    }
    if (f === "ontem") return "ontem";
    if (f === "anteriores") return "anteriores";
    if (f === "hoje") return "hoje";
    if (f === "aVencer") return "aVencer";
    return "atrasados";
  };

  useScrollRestoration("cobrancas-list");

  const defaultTab: TabId = modoCarencia10 ? "hoje" : "atrasados";
  const [activeTab, setActiveTab] = useUrlState<TabId>("tab", resolveTab(initialFiltro), defaultTab, resolveTab);

  // Seleção única: os ids de parcela são únicos entre abas, e só vale o que está visível.
  const [selecionados, setSelecionados] = useState<Set<string>>(() => new Set());

  // Busca / ordenação / filtro rápido (valem para a aba aberta)
  const [busca, setBusca] = useState("");
  const buscaAdiada = useDeferredValue(busca);
  const [ordem, setOrdem] = useState<Ordem>("vencimento");
  const [soNaoCobrados, setSoNaoCobrados] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  // Os modelos de mensagem são editados em /configuracoes/mensagens (salvos no banco).
  // O texto final de cada cobrança já vem renderizado do servidor em `p.mensagem`,
  // então o que aparece no link do botão Cobrar é exatamente o que o disparo em massa envia.
  const [cobradas, setCobradas] = useState<Set<string>>(() => new Set(cobradasHoje));
  const cobradasRef = useRef(cobradas);
  useEffect(() => {
    cobradasRef.current = cobradas;
  }, [cobradas]);
  /** Cobranças feitas nesta sessão (sobrepõe a "última cobrança" vinda do servidor). */
  const [ultimoEnvio, setUltimoEnvio] = useState<Record<string, string>>({});

  const [alvoModal, setAlvoModal] = useState<Parcela[] | null>(null);
  const [acaoModal, setAcaoModal] = useState<{ parcela: Parcela; acao: TipoAcaoEmprestimo } | null>(null);
  const [toast, setToast] = useState<{ id: number; texto: string; erro?: boolean } | null>(null);
  const [toastClosing, setToastClosing] = useState(false);

  // Toast some sozinho com transição de saída
  useEffect(() => {
    if (!toast) return;
    setToastClosing(false);
    const t = setTimeout(() => {
      setToastClosing(true);
      setTimeout(() => {
        setToast(null);
        setToastClosing(false);
      }, 150);
    }, 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const mostrarToast = useCallback((texto: string, erro = false) => setToast({ id: Date.now(), texto, erro }), []);

  // Atalho "/" foca a busca (como em apps modernos)
  useEffect(() => {
    const aoTecla = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) {
        e.preventDefault();
        buscaRef.current?.focus();
      }
    };
    document.addEventListener("keydown", aoTecla);
    return () => document.removeEventListener("keydown", aoTecla);
  }, []);

  // ─────────── Dados da aba aberta ───────────
  const tipoAtual: TipoCobranca = activeTab === "hoje" ? "hoje" : activeTab === "aVencer" ? "aVencer" : "atrasados";
  const listaBase = modoCarencia10
    ? activeTab === "hoje" ? hojeCarencia10
      : activeTab === "carencia_10" ? carencia10Lista
      : activeTab === "aVencer" ? aVencer
      : atrasados10Lista
    : activeTab === "ontem" ? atrasadosOntem
      : activeTab === "anteriores" ? atrasadosAnteriores
      : activeTab === "hoje" ? hojeLista
      : activeTab === "aVencer" ? aVencer
      : atrasados;

  const titulo = modoCarencia10
    ? activeTab === "hoje" ? "Hoje (Vencendo Hoje + 1 e 2 dias)"
      : activeTab === "carencia_10" ? "De 10 Dias de Carência (2 a 10 dias)"
      : activeTab === "aVencer" ? "Grupo: A Vencer (em até 3 dias)"
      : "Atrasados (10+ dias)"
    : activeTab === "ontem" ? (modoCarencia ? "Carência: Vencidos Ontem" : "Atrasados Ontem")
      : activeTab === "anteriores" ? (modoCarencia ? "Carência / Atrasados Anteriores (2+ dias)" : "Atrasados Anteriores (2+ dias)")
      : activeTab === "hoje" ? "Grupo: Vencendo Hoje"
      : activeTab === "aVencer" ? "Grupo: A Vencer (em até 3 dias)"
      : (modoCarencia ? "Todos em Carência / Atrasados" : "Todos Atrasados / Vencidos");
  const corTema: CorTema =
    activeTab === "ontem" || activeTab === "carencia_10" ? "orange"
    : activeTab === "anteriores" ? "red"
    : activeTab === "hoje" ? "amber"
    : activeTab === "aVencer" ? "emerald"
    : "rose";
  const tema = TEMAS[corTema];
  const textoVazio =
    activeTab === "carencia_10" ? "Nenhuma parcela em carência (2 a 10 dias)"
    : tipoAtual === "atrasados" ? "Nenhuma parcela atrasada nesta categoria"
    : tipoAtual === "hoje" ? "Nenhuma parcela nesta faixa de hoje"
    : "Nenhuma parcela vence nos próximos 3 dias";

  const filtrosAtivos = busca.trim() !== "" || soNaoCobrados;
  const limparFiltros = () => {
    setBusca("");
    setSoNaoCobrados(false);
  };

  const visiveis = useMemo(() => {
    const q = semAcento(buscaAdiada.trim());
    const qDigitos = buscaAdiada.replace(/\D/g, "");
    let lista = listaBase.filter((p) => {
      if (soNaoCobrados && cobradas.has(p.id)) return false;
      if (!q) return true;
      const c = p.emprestimo.cliente;
      if (semAcento(c.nome).includes(q)) return true;
      return qDigitos.length >= 3 && c.telefone.replace(/\D/g, "").includes(qDigitos);
    });
    if (ordem === "valor") lista = [...lista].sort((a, b) => b.valor - a.valor);
    else if (ordem === "nome") lista = [...lista].sort((a, b) => a.emprestimo.cliente.nome.localeCompare(b.emprestimo.cliente.nome, "pt-BR"));
    return lista; // "vencimento": a lista base já vem do mais antigo para o mais novo
  }, [listaBase, buscaAdiada, soNaoCobrados, ordem, cobradas]);

  // Agrupar parcelas visíveis por cliente (mantendo a ordem da primeira parcela de cada cliente, igual ao módulo Empréstimos)
  const gruposVisiveis = useMemo(() => {
    const map = new Map<string, { clienteId: string; parcelas: Parcela[] }>();
    for (const p of visiveis) {
      const cid = p.emprestimo.cliente.id;
      const g = map.get(cid);
      if (g) g.parcelas.push(p);
      else map.set(cid, { clienteId: cid, parcelas: [p] });
    }
    return Array.from(map.values());
  }, [visiveis]);

  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(() => new Set());
  const toggleGrupo = useCallback((clienteId: string) => {
    setGruposAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(clienteId)) next.delete(clienteId);
      else next.add(clienteId);
      return next;
    });
  }, []);

  // Só conta o que está selecionado E visível (filtrar nunca "esconde" envios)
  const selecionadasVisiveis = useMemo(() => visiveis.filter((p) => selecionados.has(p.id)), [visiveis, selecionados]);
  const todasMarcadas = visiveis.length > 0 && selecionadasVisiveis.length === visiveis.length;
  const algumaMarcada = selecionadasVisiveis.length > 0 && !todasMarcadas;

  // Animação suave de entrada e saída da barra flutuante
  const [barraVisivel, setBarraVisivel] = useState(false);
  const [barraSaindo, setBarraSaindo] = useState(false);
  const lastCountRef = useRef(0);

  useEffect(() => {
    if (selecionadasVisiveis.length > 0) {
      lastCountRef.current = selecionadasVisiveis.length;
      setBarraVisivel(true);
      setBarraSaindo(false);
    } else if (barraVisivel && !barraSaindo) {
      setBarraSaindo(true);
      const timer = setTimeout(() => {
        setBarraVisivel(false);
        setBarraSaindo(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [selecionadasVisiveis.length, barraVisivel, barraSaindo]);

  // Resumo da aba (sobre a lista completa, sem filtros)
  const resumo = useMemo(() => {
    const clientes = new Set(listaBase.map((p) => p.emprestimo.cliente.id)).size;
    const cobradasNaAba = listaBase.filter((p) => cobradas.has(p.id)).length;
    const maiorAtraso = listaBase.reduce((m, p) => Math.max(m, p.diasAtraso), 0);
    const maiorParcela = listaBase.reduce((m, p) => Math.max(m, p.valor), 0);
    const total = listaBase.reduce((acc, p) => acc + p.valor, 0);
    return { clientes, cobradasNaAba, maiorAtraso, maiorParcela, total };
  }, [listaBase, cobradas]);
  const pctCobradas = listaBase.length ? Math.round((resumo.cobradasNaAba / listaBase.length) * 100) : 0;

  // ─────────── Ações ───────────
  const onToggle = useCallback((id: string, checked: boolean) => {
    setSelecionados((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const onToggleGrupo = useCallback((ids: string[], checked: boolean) => {
    setSelecionados((prev) => {
      const n = new Set(prev);
      for (const id of ids) {
        if (checked) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }, []);

  const alternarTodas = (checked: boolean) => {
    setSelecionados((prev) => {
      const n = new Set(prev);
      for (const p of visiveis) {
        if (checked) n.add(p.id);
        else n.delete(p.id);
      }
      return n;
    });
  };

  const onCobrar = useCallback(
    (p: Parcela, tipo: TipoCobranca) => {
      const jaEstava = cobradasRef.current.has(p.id);
      // Atualiza a tela na hora; o registro no histórico acontece em segundo plano
      setCobradas((prev) => new Set(prev).add(p.id));
      setUltimoEnvio((prev) => ({ ...prev, [p.id]: new Date().toISOString() }));
      mostrarToast(`WhatsApp aberto — cobrança de ${p.emprestimo.cliente.nome.split(" ")[0]} registrada`);

      registrarCobrancaManual(p.id, tipo)
        .then((r) => {
          if (!r.ok) throw new Error(r.erro);
        })
        .catch(() => {
          if (!jaEstava) {
            setCobradas((prev) => {
              const n = new Set(prev);
              n.delete(p.id);
              return n;
            });
          }
          setUltimoEnvio((prev) => {
            const resto = { ...prev };
            delete resto[p.id];
            return resto;
          });
          mostrarToast("Não foi possível registrar a cobrança no histórico", true);
        });
    },
    [mostrarToast]
  );

  const onCopiar = useCallback(
    async (p: Parcela) => {
      try {
        await navigator.clipboard.writeText(p.mensagem);
        mostrarToast("Mensagem copiada");
      } catch {
        mostrarToast("Não foi possível copiar a mensagem", true);
      }
    },
    [mostrarToast]
  );

  const onAcaoEmprestimo = useCallback((parcela: Parcela, acao: TipoAcaoEmprestimo) => {
    setAcaoModal({ parcela, acao });
  }, []);

  const aoEnviarEmMassa = (ids: string[]) => {
    const agora = new Date().toISOString();
    setCobradas((prev) => new Set([...prev, ...ids]));
    setUltimoEnvio((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, agora])) }));
    setSelecionados((prev) => {
      const n = new Set(prev);
      ids.forEach((id) => n.delete(id));
      return n;
    });
    mostrarToast(`${ids.length} ${ids.length === 1 ? "cobrança enviada" : "cobranças enviadas"} com sucesso`);
  };

  const fecharModal = useCallback(() => setAlvoModal(null), []);

  return (
    <div className="space-y-5 w-full max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1880px] mx-auto px-1 animate-fade-in">
      {/* Header mobile-compacto */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Cobranças
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 hidden sm:block">
            Gerenciamento de lembretes e cobranças.
          </p>
        </div>
        <Link
          href="/configuracoes/mensagens"
          className="btn-press flex items-center gap-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-emerald-200 px-3 py-2 rounded-xl text-xs font-bold shadow-sm cursor-pointer"
        >
          <Settings className="w-3.5 h-3.5 text-emerald-500" />
          <span>Mensagens</span>
        </Link>
      </div>

      {!pixConfigurado && (
        <Link
          href="/configuracoes/mensagens#pix"
          className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-xs font-semibold hover:bg-amber-100 transition-colors"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Sua chave Pix ainda não está cadastrada, então o rodapé de pagamento não será enviado nas cobranças. Toque aqui para configurar.
        </Link>
      )}

      {/* Tabs de Filtro */}
      {modoCarencia10 ? (
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: "hoje" as TabId,        label: "Hoje",             sublabel: "1 e 2 dias",  count: hojeCarencia10.length,   color: "amber"  },
            { id: "carencia_10" as TabId, label: "10 Dias Carência", sublabel: "2 a 10 dias", count: carencia10Lista.length,  color: "orange" },
            { id: "atrasados" as TabId,   label: "Atrasados",        sublabel: "10+ dias",    count: atrasados10Lista.length, color: "rose"   },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === tab.id
                  ? tab.color === "amber"  ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                  : tab.color === "orange" ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                  :                          "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                  : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className={`text-lg font-black leading-none ${
                activeTab === tab.id ? "text-white" :
                tab.color === "amber"  ? "text-amber-500" :
                tab.color === "orange" ? "text-orange-500" :
                "text-rose-500"
              }`}>{tab.count}</span>
              <span className="font-extrabold text-[11px] leading-tight truncate w-full text-center">{tab.label}</span>
              <span className="text-[9px] leading-tight opacity-70 truncate w-full text-center">{tab.sublabel}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {([
            { id: "atrasados" as TabId, label: "Todos",    sublabel: modoCarencia ? "Carência / Atraso" : "Atrasados", count: atrasados.length,           color: "rose"    },
            { id: "ontem" as TabId,     label: "Ontem",    sublabel: modoCarencia ? "Carência" : "Atrasados",          count: atrasadosOntem.length,      color: "orange"  },
            { id: "anteriores" as TabId,label: "Anteriores",sublabel: "+ 2 dias", count: atrasadosAnteriores.length, color: "red"     },
            { id: "hoje" as TabId,      label: "Hoje",     sublabel: "Vencem",    count: hojeLista.length,           color: "amber"   },
            { id: "aVencer" as TabId,   label: "A Vencer", sublabel: "3 dias",    count: aVencer.length,             color: "emerald" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === tab.id
                  ? tab.color === "rose"    ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                  : tab.color === "orange"  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                  : tab.color === "red"     ? "bg-red-600 text-white shadow-lg shadow-red-600/20"
                  : tab.color === "amber"   ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                  :                          "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                  : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              <span className={`text-lg font-black leading-none ${
                activeTab === tab.id ? "text-white" :
                tab.color === "rose"   ? "text-rose-500" :
                tab.color === "orange" ? "text-orange-500" :
                tab.color === "red"    ? "text-red-600" :
                tab.color === "amber"  ? "text-amber-500" :
                "text-emerald-600"
              }`}>{tab.count}</span>
              <span className="font-extrabold text-[11px] leading-tight">{tab.label}</span>
              <span className={`text-[9px] leading-tight opacity-70`}>{tab.sublabel}</span>
            </button>
          ))}
        </div>
      )}

      {/* Conteúdo da aba — remonta ao trocar de aba para animar a entrada */}
      <div key={activeTab} className="space-y-3 animate-tab-in">
        {/* Título + total */}
        <div className={`flex items-center justify-between gap-2 border-b pb-2 ${tema.headBorder}`}>
          <div className="flex items-center space-x-2 min-w-0">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tema.dot} ${tipoAtual === "atrasados" ? "animate-pulse" : ""}`} />
            <h2 className={`text-md font-extrabold truncate ${tema.title}`}>{titulo}</h2>
          </div>
          <span className={`text-xs font-black px-2.5 py-1 rounded-md uppercase tracking-wider whitespace-nowrap ${tema.pill}`}>
            {formatBRL(resumo.total)} ({listaBase.length} parcelas)
          </span>
        </div>

        {/* Resumo rápido */}
        {listaBase.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 shadow-sm flex items-center gap-2.5">
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tema.soft}`}>
                <Users className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-base sm:text-lg font-black text-slate-900 leading-tight tabular-nums">{resumo.clientes}</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">Clientes</div>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-1">
                <div className="text-base sm:text-lg font-black text-slate-900 leading-tight tabular-nums">
                  {resumo.cobradasNaAba}
                  <span className="text-xs font-bold text-slate-400">/{listaBase.length}</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              </div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">Cobrados hoje</div>
              <div className="mt-1.5 h-1 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-700 ease-out" style={{ width: `${pctCobradas}%` }} />
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-3 py-2.5 shadow-sm flex items-center gap-2.5">
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tema.soft}`}>
                <Flame className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <div className="text-base sm:text-lg font-black text-slate-900 leading-tight truncate tabular-nums">
                  {resumo.maiorAtraso > 0 ? `${resumo.maiorAtraso} ${resumo.maiorAtraso === 1 ? "dia" : "dias"}` : formatBRL(resumo.maiorParcela)}
                </div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide truncate">
                  {resumo.maiorAtraso > 0 ? "Maior atraso" : "Maior parcela"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cartão da lista */}
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
          {/* Barra de seleção + busca + ordenação */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = algumaMarcada;
                  }}
                  checked={todasMarcadas}
                  onChange={(e) => alternarTodas(e.target.checked)}
                  aria-label="Selecionar todos os exibidos"
                  className={`w-[18px] h-[18px] rounded border-slate-300 cursor-pointer ${tema.accent}`}
                  disabled={visiveis.length === 0}
                />
                <span className="text-xs font-black text-slate-500 uppercase tracking-wider tabular-nums">
                  {selecionadasVisiveis.length} de {visiveis.length} selecionados
                  {visiveis.length !== gruposVisiveis.length && (
                    <span className="text-slate-400 font-bold ml-1.5">
                      · {gruposVisiveis.length} {gruposVisiveis.length === 1 ? "cliente" : "clientes"}
                    </span>
                  )}
                </span>
              </div>
              {filtrosAtivos && (
                <button
                  type="button"
                  onClick={limparFiltros}
                  className="animate-pop text-[11px] font-bold text-slate-500 hover:text-emerald-700 transition-colors cursor-pointer"
                >
                  Limpar filtros
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[10rem]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={buscaRef}
                  type="search"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome ou telefone  ( / )"
                  aria-label="Buscar parcelas"
                  className={`w-full h-9 pl-9 pr-8 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-all focus:ring-4 ${tema.ring} [&::-webkit-search-cancel-button]:hidden`}
                />
                {busca && (
                  <button
                    type="button"
                    onClick={() => {
                      setBusca("");
                      buscaRef.current?.focus();
                    }}
                    aria-label="Limpar busca"
                    className="animate-pop absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="relative">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={ordem}
                  onChange={(e) => setOrdem(e.target.value as Ordem)}
                  aria-label="Ordenar por"
                  className={`h-9 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 outline-none cursor-pointer transition-all focus:ring-4 ${tema.ring}`}
                >
                  {ORDENS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {modoCarencia10 && (
                <button
                  type="button"
                  aria-pressed={activeTab === "aVencer"}
                  onClick={() => setActiveTab(activeTab === "aVencer" ? "hoje" : "aVencer")}
                  className={`btn-press h-9 px-3 inline-flex items-center gap-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                    activeTab === "aVencer" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  A Vencer 3d ({aVencer.length})
                </button>
              )}

              <button
                type="button"
                aria-pressed={soNaoCobrados}
                onClick={() => setSoNaoCobrados((v) => !v)}
                className={`btn-press h-9 px-3 inline-flex items-center gap-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                  soNaoCobrados ? tema.chip : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {soNaoCobrados && <Check className="w-3.5 h-3.5 animate-pop" strokeWidth={3} />}
                Não cobrados hoje
              </button>
            </div>
          </div>

          {/* Linhas */}
          <div className="divide-y divide-slate-100">
            {listaBase.length === 0 ? (
              <div className="py-14 flex flex-col items-center gap-2.5 text-center animate-tab-in">
                <span className={`w-14 h-14 rounded-2xl flex items-center justify-center ${tema.soft}`}>
                  <CheckCircle2 className="w-7 h-7" />
                </span>
                <p className="text-sm font-bold text-slate-700">{textoVazio}</p>
                <p className="text-xs text-slate-400">Tudo em dia por aqui.</p>
              </div>
            ) : visiveis.length === 0 ? (
              <div className="py-14 flex flex-col items-center gap-2.5 text-center animate-tab-in">
                <span className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
                  <SearchX className="w-7 h-7" />
                </span>
                <p className="text-sm font-bold text-slate-700">Nenhum resultado</p>
                <p className="text-xs text-slate-400">
                  {busca.trim() ? `Nada encontrado para “${busca.trim()}”.` : "Todas as parcelas desta aba já foram cobradas hoje."}
                </p>
                {filtrosAtivos && (
                  <button
                    type="button"
                    onClick={limparFiltros}
                    className="btn-press mt-1 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:border-emerald-300 hover:text-emerald-700 cursor-pointer"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              gruposVisiveis.map((grupo, i) =>
                grupo.parcelas.length === 1 ? (
                  <ParcelaRow
                    key={grupo.parcelas[0].id}
                    p={grupo.parcelas[0]}
                    index={i}
                    tema={tema}
                    tipo={tipoAtual}
                    selecionado={selecionados.has(grupo.parcelas[0].id)}
                    cobradoHoje={cobradas.has(grupo.parcelas[0].id)}
                    ultimoEnvio={ultimoEnvio[grupo.parcelas[0].id] ?? grupo.parcelas[0].ultimaCobranca}
                    onToggle={onToggle}
                    onCobrar={onCobrar}
                    onCopiar={onCopiar}
                    onAcaoEmprestimo={onAcaoEmprestimo}
                    modoCarencia={modoCarencia}
                    modoCarencia10={modoCarencia10}
                  />
                ) : (
                  <GrupoParcelaRow
                    key={`grupo-${grupo.clienteId}`}
                    clienteId={grupo.clienteId}
                    parcelas={grupo.parcelas}
                    index={i}
                    aberto={gruposAbertos.has(grupo.clienteId)}
                    tema={tema}
                    tipo={tipoAtual}
                    selecionados={selecionados}
                    cobradas={cobradas}
                    ultimoEnvioMap={ultimoEnvio}
                    onToggleExpand={toggleGrupo}
                    onToggleParcela={onToggle}
                    onToggleGrupo={onToggleGrupo}
                    onCobrar={onCobrar}
                    onCopiar={onCopiar}
                    onAcaoEmprestimo={onAcaoEmprestimo}
                    modoCarencia={modoCarencia}
                    modoCarencia10={modoCarencia10}
                  />
                )
              )
            )}
          </div>
        </div>
      </div>

      {/* Barra flutuante: aparece ao selecionar e acompanha a rolagem */}
      {barraVisivel && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 z-40 flex justify-center px-3 pointer-events-none">
          <div className={`pointer-events-auto w-full max-w-md flex items-center gap-2 bg-[#064e3b] text-white rounded-2xl pl-4 pr-2 py-2 shadow-2xl shadow-emerald-950/30 border border-emerald-800 ${
            barraSaindo ? "motion-float-bar-out" : "animate-slide-up"
          }`}>
            <span className="text-xs font-semibold flex-1 min-w-0 truncate">
              <strong key={selecionadasVisiveis.length || lastCountRef.current} className="animate-pop inline-block text-sm font-black tabular-nums">
                {selecionadasVisiveis.length || lastCountRef.current}
              </strong>{" "}
              {(selecionadasVisiveis.length || lastCountRef.current) === 1 ? "selecionado" : "selecionados"}
            </span>
            <button
              type="button"
              onClick={() => setSelecionados(new Set())}
              className="btn-press px-3 py-2 rounded-xl text-xs font-bold text-emerald-100/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setAlvoModal(selecionadasVisiveis)}
              className="btn-press flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 active:scale-95 transition-all text-white shadow-md shadow-emerald-950/30 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              Disparo em Massa
            </button>
          </div>
        </div>
      )}

      {/* Disparo em massa: confirmar → enviar → resumo */}
      {alvoModal && (
        <DisparoModal
          itens={alvoModal}
          tipo={tipoAtual}
          cobradasHoje={cobradas}
          onClose={fecharModal}
          onEnviados={aoEnviarEmMassa}
        />
      )}

      {/* Modal de ações rápidas do empréstimo (Renovar, Quitar, Reprogramar, Renegociar, etc.) */}
      {acaoModal && (
        <AcaoEmprestimoModal
          parcela={acaoModal.parcela}
          acao={acaoModal.acao}
          onClose={() => setAcaoModal(null)}
          onSuccess={(msg) => {
            setAcaoModal(null);
            mostrarToast(msg);
            router.refresh();
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed inset-x-0 top-4 z-[70] flex justify-center px-3 pointer-events-none">
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-center gap-2 bg-white border rounded-xl px-4 py-2.5 text-xs font-bold shadow-xl shadow-slate-900/10 ${
              toastClosing ? "animate-toast-out" : "animate-toast-in"
            } ${
              toast.erro ? "border-red-200 text-red-700" : "border-emerald-200 text-slate-700"
            }`}
          >
            {toast.erro ? <AlertCircle className="w-4 h-4 text-red-500" /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            {toast.texto}
          </div>
        </div>
      )}
    </div>
  );
}
