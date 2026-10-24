"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useUrlState } from "@/hooks/useUrlState";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import Link from "next/link";
import { Search, Calendar, MessageCircle, ArrowUpDown, ArrowDownUp, Clock, ChevronLeft, ChevronRight, CheckCircle2, AlertCircle, X, Send, Settings, Plus, Trash2, Loader2, ChevronDown, RefreshCw, PauseCircle, Layers, TrendingUp } from "lucide-react";
import { receberSoJurosEmprestimo } from "@/app/emprestimos/[id]/actions";
import { enviarMensagemManual, listarRespostasRapidas } from "@/app/mensagens/actions";
import { hojeEmBrasilia } from "@/lib/dateUtils";

interface Cliente {
  id: string;
  nome: string;
  telefone: string;
  cidade: string;
}

interface Parcela {
  id: string;
  numero: number;
  valor: number;
  data_vencimento: Date;
  status: string;
}

interface Emprestimo {
  id: string;
  valor_emprestado: any;
  taxa_juros: any;
  taxa_multa: any;
  data_vencimento: Date;
  status: string;
  tipo_pagamento: string;
  frequencia: string;
  categoria: string;
  cliente: Cliente;
  parcelas: Parcela[];
  parceiro_id?: string | null;
  parceiro?: { id: string; nome: string } | null;
}

interface EmprestimosListWrapperProps {
  initialEmprestimos: any[];
  initialFiltro?:      string;
  initialSearch?:      string;
  initialParceiro?:    string;
  initialSort?:        string;
  initialPagina?:      number;
  initialDiasAtraso?:  string;
  modoCarencia?:       boolean;
  modoCarencia10?:     boolean;
}

type StatusFilter = 
  | "todos" 
  | "ativos" 
  | "atrasados" 
  | "ontem" 
  | "quitados" 
  | "hoje" 
  | "pausados"
  | "carencia"
  | "carencia_5"
  | "carencia_10"
  | "carencia_15"
  | "atrasados_30";

type SortOption = 
  | "padrao" 
  | "alfabetica_az"
  | "alfabetica_za"
  | "maior_valor" 
  | "menor_valor" 
  | "mais_proximo" 
  | "mais_distante"
  | "maior_juros"
  | "menor_juros"
  | "mais_atrasados";

const sortLabels: Record<SortOption, string> = {
  padrao: "Padrão",
  alfabetica_az: "Ordem Alfabética (A-Z)",
  alfabetica_za: "Ordem Alfabética (Z-A)",
  maior_valor: "Maior Valor",
  menor_valor: "Menor Valor",
  mais_proximo: "Vence Antes",
  mais_distante: "Vence Depois",
  maior_juros: "Maior Taxa de Juros",
  menor_juros: "Menor Taxa de Juros",
  mais_atrasados: "Mais Dias de Atraso",
};

function resolveSort(sort?: string): SortOption {
  if (
    sort === "alfabetica_az" ||
    sort === "alfabetica_za" ||
    sort === "maior_valor" ||
    sort === "menor_valor" ||
    sort === "mais_proximo" ||
    sort === "mais_distante" ||
    sort === "maior_juros" ||
    sort === "menor_juros" ||
    sort === "mais_atrasados"
  ) {
    return sort;
  }
  return "padrao";
}

function resolveDiasAtraso(val?: string): string {
  if (val === "5" || val === "10" || val === "15" || val === "30") {
    return val;
  }
  return "0";
}

function resolveStatus(filtro: string, modoCarencia = false, modoCarencia10 = false): StatusFilter {
  if (modoCarencia10) {
    if (filtro === "hoje" || filtro === "ontem") return "hoje";
    if (filtro === "carencia_10" || filtro === "carencia" || filtro === "10") return "carencia_10";
    if (filtro === "atrasados" || filtro === "atrasados_30") return "atrasados";
    if (filtro === "todos")    return "todos";
    if (filtro === "ativos")   return "ativos";
    if (filtro === "quitados") return "quitados";
    if (filtro === "pausados") return "pausados";
    return "hoje";
  }
  if (modoCarencia) {
    if (filtro === "carencia")                       return "carencia";
    if (filtro === "carencia_5" || filtro === "5")   return "carencia_5";
    if (filtro === "carencia_10" || filtro === "10") return "carencia_10";
    if (filtro === "carencia_15" || filtro === "15") return "carencia_15";
    if (filtro === "atrasados_30" || filtro === "atrasados" || filtro === "30") return "atrasados_30";
    if (filtro === "quitados")                       return "quitados";
    if (filtro === "pausados")                       return "pausados";
    if (filtro === "todos")                          return "todos";
    return "carencia";
  }
  if (filtro === "hoje")      return "hoje";
  if (filtro === "ontem")     return "ontem";
  if (filtro === "atrasados" || filtro === "atrasados_30") return "atrasados";
  if (filtro === "quitados")  return "quitados";
  if (filtro === "todos")     return "todos";
  if (filtro === "pausados")  return "pausados";
  return "ativos";
}


export default function EmprestimosListWrapper({
  initialEmprestimos,
  initialFiltro     = "ativos",
  initialSearch     = "",
  initialParceiro   = "todos",
  initialSort       = "padrao",
  initialPagina     = 1,
  initialDiasAtraso = "0",
  modoCarencia      = false,
  modoCarencia10    = false,
}: EmprestimosListWrapperProps) {
  // ── Scroll restoration ──
  useScrollRestoration("emprestimos-list");

  // ── Estado persistido na URL ──
  const parseStatus = (f: string) => resolveStatus(f, modoCarencia, modoCarencia10);
  const defaultStatus: StatusFilter = modoCarencia10 ? "hoje" : modoCarencia ? "carencia" : "ativos";

  const [search, setSearch]                 = useUrlState("q",           initialSearch,   "");
  const [statusFilter, setStatusFilter]     = useUrlState<StatusFilter>("status", parseStatus(initialFiltro), defaultStatus, parseStatus);
  const [parceiroFilter, setParceiroFilter] = useUrlState("parceiro",    initialParceiro, "todos");
  const [sortOption, setSortOption]         = useUrlState<SortOption>("sort", resolveSort(initialSort), "padrao", resolveSort);
  const [currentPage, setCurrentPage]       = useUrlState("pagina",      String(initialPagina), "1");
  const [diasAtraso, setDiasAtraso]         = useUrlState("dias_atraso", resolveDiasAtraso(initialDiasAtraso), "0", resolveDiasAtraso);

  // Helper para mudar filtros e resetar página
  const setStatusAndReset   = (v: StatusFilter) => { setStatusFilter(v);   setCurrentPage("1"); };
  const setParceiroAndReset = (v: string)       => { setParceiroFilter(v); setCurrentPage("1"); };
  const setSortAndReset     = (v: SortOption)   => { setSortOption(v);     setCurrentPage("1"); };
  const setSearchAndReset   = (v: string)       => { setSearch(v);         setCurrentPage("1"); };

  // Handler para cliques nas tabs de status (com ciclo especial para atrasados quando modoCarencia e modoCarencia10 desativados)
  const handleTabClick = (tabId: StatusFilter) => {
    if (modoCarencia || modoCarencia10) {
      setStatusAndReset(tabId);
      if (diasAtraso !== "0") setDiasAtraso("0");
      return;
    }
    if (tabId === "atrasados") {
      if (statusFilter !== "atrasados") {
        setStatusFilter("atrasados");
        setDiasAtraso("0");
        setCurrentPage("1");
      } else {
        const cur = parseInt(diasAtraso, 10) || 0;
        let next = "0";
        if (cur === 0) next = "5";
        else if (cur === 5) next = "10";
        else if (cur === 10) next = "15";
        else if (cur === 15) next = "30";
        else next = "0";
        setDiasAtraso(next);
        setCurrentPage("1");
      }
    } else {
      setStatusAndReset(tabId);
      if (diasAtraso !== "0") setDiasAtraso("0");
    }
  };

  const currentPageNum = parseInt(currentPage, 10) || 1;
  const ITEMS_PER_PAGE = 10;

  // sortOpen é estado local (não persiste na URL)
  const [sortOpen, setSortOpen] = useState(false);

  // Renovação rápida
  const [renewModalEmp, setRenewModalEmp] = useState<any>(null);
  const [renewClosing, setRenewClosing]   = useState(false);
  const [isRenewing, setIsRenewing]       = useState(false);
  const [renewError, setRenewError]       = useState<string | null>(null);
  const [isPendingRenew, startRenewTransition] = useTransition();

  const openRenewModal = (e: React.MouseEvent, emp: any) => {
    e.preventDefault();
    e.stopPropagation();
    setRenewError(null);
    setRenewClosing(false);
    setRenewModalEmp(emp);
  };

  const closeRenewModal = () => {
    setRenewClosing(true);
    setTimeout(() => {
      setRenewModalEmp(null);
      setRenewClosing(false);
      setRenewError(null);
    }, 150);
  };

  const confirmRenew = (enviarWhatsapp: boolean) => {
    if (!renewModalEmp) return;
    setIsRenewing(true);
    setRenewError(null);
    startRenewTransition(async () => {
      try {
        const res = await receberSoJurosEmprestimo(renewModalEmp.id, enviarWhatsapp);
        const clienteNome = renewModalEmp.cliente?.nome || "cliente";
        closeRenewModal();
        if (res?.whatsappEnviado) {
          alert(`Empréstimo renovado com sucesso!\nMensagem enviada para ${clienteNome} no WhatsApp:\n\n"${res.whatsappTexto}"`);
        } else if (res?.whatsappErro) {
          alert(`Empréstimo renovado com sucesso!\n(Aviso: não foi possível enviar WhatsApp: ${res.whatsappErro})`);
        } else {
          alert(
            enviarWhatsapp
              ? "Empréstimo renovado com sucesso!"
              : "Empréstimo renovado com sucesso (sem envio no WhatsApp)!"
          );
        }
      } catch (err: any) {
        setRenewError(err.message || "Erro ao renovar o empréstimo.");
      } finally {
        setIsRenewing(false);
      }
    });
  };

  // WhatsApp Modal State
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waClosing, setWaClosing] = useState(false);
  const [waSelectedEmp, setWaSelectedEmp] = useState<any>(null);
  const [waCustomMsg, setWaCustomMsg] = useState("");
  const [isWaSending, setIsWaSending] = useState(false);
  // Lista única de respostas rápidas, salva no banco (edição em /configuracoes/mensagens)
  const [waTemplates, setWaTemplates] = useState<string[]>([]);

  useEffect(() => {
    listarRespostasRapidas().then(setWaTemplates).catch(() => {});
  }, []);

  const openWaModal = (emp: any) => {
    setWaSelectedEmp(emp);
    setWaCustomMsg("");
    setWaClosing(false);
    setWaModalOpen(true);
  };

  const closeWaModal = () => {
    setWaClosing(true);
    setTimeout(() => {
      setWaModalOpen(false);
      setWaClosing(false);
    }, 150);
  };

  const sendWaMsg = async (text: string) => {
    if (!waSelectedEmp || !text.trim()) return;
    setIsWaSending(true);
    try {
      const res = await enviarMensagemManual({
        clienteId: waSelectedEmp.cliente.id,
        emprestimoId: waSelectedEmp.id,
        texto: text,
      });
      if (res.ok) {
        closeWaModal();
        alert("Mensagem enviada com sucesso!");
      } else {
        alert(`Falha ao enviar: ${res.erro || "Erro desconhecido"}`);
      }
    } catch (err) {
      alert("Falha de conexão. O serviço do WhatsApp está rodando?");
    } finally {
      setIsWaSending(false);
    }
  };

  useEffect(() => {
    // O currentPage já é resetado pelos helpers setXxxAndReset
    // Este effect é mantido como safeguard para mudanças externas
  }, []);

  const parceirosList = useMemo(() => {
    const map = new Map<string, string>();
    initialEmprestimos.forEach(emp => {
      if (emp.parceiro) {
        map.set(emp.parceiro.id, emp.parceiro.nome);
      }
    });
    return Array.from(map.entries()).map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [initialEmprestimos]);

  const hojeUTC = useMemo(() => hojeEmBrasilia(), []);

  const formatBRL = (value: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

  const formatData = (date: any) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(date));

  // Processar empréstimos com status reais e totais
  const emprestimosProcessados = useMemo(() => {
    return initialEmprestimos.map((emp) => {
      const principal = Number(emp.valor_emprestado);
      const taxaJuros = Number(emp.taxa_juros) || 0;
      const valorJuros = principal * (taxaJuros / 100);

      const isExplicitRenov = (p: any) =>
        p.status === "pago_renovacao" || p.status?.includes("renovacao") || p.status === "renovado";
      const parcelasNaoRenov = (emp.parcelas || []).filter((p: any) => !isExplicitRenov(p));
      const abertasCount = (emp.parcelas || []).filter((p: any) => p.status === "aberto").length;
      const isParcelado =
        emp.tipo_pagamento === "parcelado" ||
        emp.tipo_pagamento === "parcela_juros_mes" ||
        abertasCount > 1;
      const isAVista =
        !isParcelado &&
        (emp.tipo_pagamento === "a_vista" ||
          emp.tipo_pagamento === "a_vista_juros" ||
          emp.tipo_pagamento === "juros_compostos" ||
          parcelasNaoRenov.length <= 1);

      const parcelaPrincipalAVista =
        (emp.parcelas || []).find((p: any) => p.status === "aberto") ??
        (emp.parcelas && emp.parcelas.length > 0 ? emp.parcelas[emp.parcelas.length - 1] : null);

      const totalEstimado = isAVista
        ? (parcelaPrincipalAVista ? Number(parcelaPrincipalAVista.valor) : principal * (1 + taxaJuros / 100))
        : parcelasNaoRenov.length > 0
          ? parcelasNaoRenov.reduce((acc: number, p: any) => acc + Number(p.valor), 0)
          : principal * (1 + taxaJuros / 100);

      const vencFinalObj = new Date(emp.data_vencimento);
      const dataVencimentoObjUTC = new Date(
        Date.UTC(vencFinalObj.getUTCFullYear(), vencFinalObj.getUTCMonth(), vencFinalObj.getUTCDate())
      );

      let statusReal = emp.status;
      let temAtrasada = false;
      let venceHoje = false;

      let temAtrasadaOntem = false;
      const ontemUTC = new Date(hojeUTC);
      ontemUTC.setUTCDate(hojeUTC.getUTCDate() - 1);

      if (emp.parcelas && emp.parcelas.length > 0) {
        const todasPagas = emp.parcelas.every((p: any) => p.status.startsWith("pago"));
        if (todasPagas) {
          statusReal = "quitado";
        } else {
          statusReal = "ativo";
          temAtrasada = emp.parcelas.some((p: any) => {
            if (p.status !== "aberto") return false;
            const vObj = new Date(p.data_vencimento);
            const vUTC = new Date(Date.UTC(vObj.getUTCFullYear(), vObj.getUTCMonth(), vObj.getUTCDate()));
            return vUTC < hojeUTC;
          });
          temAtrasadaOntem = emp.parcelas.some((p: any) => {
            if (p.status !== "aberto") return false;
            const vObj = new Date(p.data_vencimento);
            const vUTC = new Date(Date.UTC(vObj.getUTCFullYear(), vObj.getUTCMonth(), vObj.getUTCDate()));
            return vUTC.getTime() === ontemUTC.getTime();
          });
          venceHoje = emp.parcelas.some((p: any) => {
            if (p.status !== "aberto") return false;
            const vObj = new Date(p.data_vencimento);
            const vUTC = new Date(Date.UTC(vObj.getUTCFullYear(), vObj.getUTCMonth(), vObj.getUTCDate()));
            return vUTC.getTime() === hojeUTC.getTime();
          });
        }
      } else {
        if (emp.status === "ativo") {
          if (dataVencimentoObjUTC < hojeUTC) {
            temAtrasada = true;
            if (dataVencimentoObjUTC.getTime() === ontemUTC.getTime()) {
              temAtrasadaOntem = true;
            }
          } else if (dataVencimentoObjUTC.getTime() === hojeUTC.getTime()) {
            venceHoje = true;
          }
        }
      }

      // Cálculo dos dias de atraso (para filtro cíclico >5d, >10d, >15d, >30d)
      let diasAtrasado = 0;
      if (emp.parcelas && emp.parcelas.length > 0) {
        const parcelasAtrasadas = emp.parcelas.filter((p: any) => {
          if (p.status !== "aberto") return false;
          const vObj = new Date(p.data_vencimento);
          const vUTC = new Date(Date.UTC(vObj.getUTCFullYear(), vObj.getUTCMonth(), vObj.getUTCDate()));
          return vUTC < hojeUTC;
        });
        if (parcelasAtrasadas.length > 0) {
          const diffs = parcelasAtrasadas.map((p: any) => {
            const vObj = new Date(p.data_vencimento);
            const vUTC = new Date(Date.UTC(vObj.getUTCFullYear(), vObj.getUTCMonth(), vObj.getUTCDate()));
            return Math.floor((hojeUTC.getTime() - vUTC.getTime()) / (1000 * 3600 * 24));
          });
          diasAtrasado = Math.max(0, ...diffs);
        }
      } else if (emp.status === "ativo" && dataVencimentoObjUTC < hojeUTC) {
        diasAtrasado = Math.max(0, Math.floor((hojeUTC.getTime() - dataVencimentoObjUTC.getTime()) / (1000 * 3600 * 24)));
      }

      // Próxima parcela aberta
      let proxVencimentoUTC: Date | null = null;
      if (emp.parcelas && emp.parcelas.length > 0) {
        const abertas = emp.parcelas
          .filter((p: any) => p.status === "aberto")
          .map((p: any) => {
            const vObj = new Date(p.data_vencimento);
            return new Date(Date.UTC(vObj.getUTCFullYear(), vObj.getUTCMonth(), vObj.getUTCDate()));
          })
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());
        proxVencimentoUTC = abertas[0] || dataVencimentoObjUTC;
      } else {
        proxVencimentoUTC = dataVencimentoObjUTC;
      }

      let venceEmBreve = false;
      if (proxVencimentoUTC) {
        const diffTime = proxVencimentoUTC.getTime() - hojeUTC.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
        if (diffDays >= 0 && diffDays <= 3) {
          venceEmBreve = true;
        }
      }

      return {
        ...emp,
        principal,
        valorJuros,
        totalEstimado,
        statusReal,
        estaAtrasado: temAtrasada,
        diasAtrasado,
        estaAtrasadoOntem: temAtrasadaOntem,
        venceHoje,
        venceEmBreve,
        proxVencimentoUTC,
        dataVencimentoObjUTC,
        isAVista,
      };
    });
  }, [initialEmprestimos, hojeUTC]);

  // Filtrar + Ordenar
  const emprestimosFiltrados = useMemo(() => {
    let lista = emprestimosProcessados.filter((emp) => {
      const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const query = norm(search.trim());
      const bateTexto =
        !query ||
        norm(emp.cliente.nome).includes(query) ||
        emp.cliente.telefone.includes(query) ||
        norm(emp.cliente.cidade).includes(query);

      if (!bateTexto) return false;

      if (modoCarencia10) {
        if (statusFilter === "hoje") {
          const ehHoje10 =
            emp.statusReal === "ativo" &&
            emp.status !== "pausado" &&
            ((emp.venceHoje && emp.diasAtrasado === 0) || (emp.diasAtrasado >= 1 && emp.diasAtrasado <= 2));
          if (!ehHoje10) return false;
        } else if (statusFilter === "carencia_10") {
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado <= 2 || emp.diasAtrasado > 10) return false;
        } else if (statusFilter === "atrasados") {
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado <= 10) return false;
        } else if (statusFilter === "ativos") {
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado > 10) return false;
        } else if (statusFilter === "quitados") {
          if (emp.statusReal !== "quitado") return false;
        } else if (statusFilter === "pausados") {
          if (emp.status !== "pausado") return false;
        }
      } else if (modoCarencia) {
        if (statusFilter === "carencia") {
          // Todos os ativos dentro do período de tolerância/carência (diasAtrasado <= 30)
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado > 30) return false;
        } else if (statusFilter === "carencia_5") {
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado <= 5 || emp.diasAtrasado > 30) return false;
        } else if (statusFilter === "carencia_10") {
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado <= 10 || emp.diasAtrasado > 30) return false;
        } else if (statusFilter === "carencia_15") {
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado <= 15 || emp.diasAtrasado > 30) return false;
        } else if (statusFilter === "atrasados_30") {
          // De fato atrasados (estouraram carência de 30 dias)
          if (emp.statusReal !== "ativo" || emp.status === "pausado" || emp.diasAtrasado <= 30) return false;
        } else if (statusFilter === "quitados") {
          if (emp.statusReal !== "quitado") return false;
        } else if (statusFilter === "pausados") {
          if (emp.status !== "pausado") return false;
        }
      } else {
        if (statusFilter === "ativos" && (emp.statusReal !== "ativo" || emp.estaAtrasado || emp.status === "pausado")) return false;
        if (statusFilter === "atrasados") {
          if (!emp.estaAtrasado) return false;
          const minDias = parseInt(diasAtraso, 10) || 0;
          if (minDias > 0 && emp.diasAtrasado <= minDias) return false;
        }
        if (statusFilter === "ontem" && !emp.estaAtrasadoOntem) return false;
        if (statusFilter === "quitados" && emp.statusReal !== "quitado") return false;
        if (statusFilter === "hoje" && !emp.venceHoje) return false;
        if (statusFilter === "pausados" && emp.status !== "pausado") return false;
      }


      if (parceiroFilter !== "todos") {
        if (parceiroFilter === "sem_parceiro") {
          if (emp.parceiro_id) return false;
        } else {
          if (emp.parceiro_id !== parceiroFilter) return false;
        }
      }

      return true;
    });

    // Ordenação
    switch (sortOption) {
      case "alfabetica_az":
        lista = [...lista].sort((a, b) =>
          a.cliente.nome.localeCompare(b.cliente.nome, "pt-BR", { sensitivity: "base" })
        );
        break;
      case "alfabetica_za":
        lista = [...lista].sort((a, b) =>
          b.cliente.nome.localeCompare(a.cliente.nome, "pt-BR", { sensitivity: "base" })
        );
        break;
      case "maior_valor":
        lista = [...lista].sort((a, b) => b.totalEstimado - a.totalEstimado);
        break;
      case "menor_valor":
        lista = [...lista].sort((a, b) => a.totalEstimado - b.totalEstimado);
        break;
      case "mais_proximo":
        lista = [...lista].sort((a, b) => {
          const ta = a.proxVencimentoUTC?.getTime() ?? Infinity;
          const tb = b.proxVencimentoUTC?.getTime() ?? Infinity;
          return ta - tb;
        });
        break;
      case "mais_distante":
        lista = [...lista].sort((a, b) => {
          const ta = a.proxVencimentoUTC?.getTime() ?? 0;
          const tb = b.proxVencimentoUTC?.getTime() ?? 0;
          return tb - ta;
        });
        break;
      case "maior_juros":
        lista = [...lista].sort((a, b) => (Number(b.taxa_juros) || 0) - (Number(a.taxa_juros) || 0));
        break;
      case "menor_juros":
        lista = [...lista].sort((a, b) => (Number(a.taxa_juros) || 0) - (Number(b.taxa_juros) || 0));
        break;
      case "mais_atrasados":
        lista = [...lista].sort((a, b) => b.diasAtrasado - a.diasAtrasado);
        break;
      default:
        break;
    }

    return lista;
  }, [emprestimosProcessados, search, statusFilter, sortOption, parceiroFilter, diasAtraso, modoCarencia, modoCarencia10]);

  // Agrupar empréstimos filtrados por cliente (a ordem do primeiro empréstimo de cada cliente é mantida)
  const grupos = useMemo(() => {
    const map = new Map<string, { clienteId: string; emprestimos: any[] }>();
    emprestimosFiltrados.forEach((emp) => {
      const g = map.get(emp.cliente.id);
      if (g) g.emprestimos.push(emp);
      else map.set(emp.cliente.id, { clienteId: emp.cliente.id, emprestimos: [emp] });
    });
    return Array.from(map.values());
  }, [emprestimosFiltrados]);

  const totalPages = Math.max(1, Math.ceil(grupos.length / ITEMS_PER_PAGE));
  const paginatedGrupos = grupos.slice(
    (currentPageNum - 1) * ITEMS_PER_PAGE,
    currentPageNum * ITEMS_PER_PAGE
  );

  // Grupos (clientes com 2+ empréstimos) expandidos
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set());
  const toggleGrupo = (clienteId: string) =>
    setGruposAbertos((prev) => {
      const next = new Set(prev);
      if (next.has(clienteId)) next.delete(clienteId);
      else next.add(clienteId);
      return next;
    });

  // Card individual de um empréstimo (usado solto na lista ou como subcard dentro de um grupo)
  const renderCard = (emp: any, sub = false) => {
    const isQuitado = emp.statusReal === "quitado";
    const isPausado = emp.status === "pausado";
    const isAtrasado = modoCarencia10
      ? (emp.statusReal === "ativo" && emp.diasAtrasado > 10 && !isPausado)
      : modoCarencia
        ? (emp.statusReal === "ativo" && emp.diasAtrasado > 30 && !isPausado)
        : emp.estaAtrasado;
    const isCarencia = modoCarencia10
      ? (emp.statusReal === "ativo" && !isPausado && !isQuitado && emp.diasAtrasado > 2 && emp.diasAtrasado <= 10)
      : (modoCarencia && emp.statusReal === "ativo" && !isPausado && !isQuitado && emp.diasAtrasado > 0 && emp.diasAtrasado <= 30);
    const isHoje10 = modoCarencia10 && emp.statusReal === "ativo" && !isPausado && !isQuitado && ((emp.venceHoje && emp.diasAtrasado === 0) || (emp.diasAtrasado >= 1 && emp.diasAtrasado <= 2));
    const isVencendo = !isCarencia && !isAtrasado && (isHoje10 || emp.venceHoje || emp.venceEmBreve);

    // Accent colors for the card
    let accentColor = "bg-emerald-500";
    let borderColor = "border-slate-200";
    let bgClass = "bg-white";
    let textColor = "text-emerald-600";

    if (isPausado) {
      accentColor = "bg-yellow-400";
      borderColor = "border-yellow-200";
      bgClass = "bg-yellow-50/30";
      textColor = "text-yellow-700";
    } else if (isQuitado) {
      accentColor = "bg-slate-300";
      bgClass = "bg-slate-50/50";
      textColor = "text-slate-500";
    } else if (isAtrasado) {
      accentColor = "bg-rose-500";
      borderColor = "border-rose-200";
      bgClass = "bg-white";
      textColor = "text-rose-600";
    } else if (isCarencia) {
      accentColor = "bg-amber-500";
      borderColor = "border-amber-200";
      bgClass = "bg-amber-50/30";
      textColor = "text-amber-700";
    } else if (isVencendo) {
      accentColor = "bg-amber-500";
      borderColor = "border-amber-200";
      bgClass = "bg-amber-50/30";
      textColor = "text-amber-600";
    }

    return (
      <div
        key={emp.id}
        className={`group relative overflow-hidden rounded-2xl border ${borderColor} ${bgClass} ${sub ? "p-4" : "p-5"} shadow-sm hover:shadow-md transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-4 active:scale-[0.98] cursor-pointer`}
      >
        {/* Accent Line Left */}
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor}`} />

        <Link
          href={`/emprestimos/${emp.id}`}
          onClick={() => {
            if (typeof window !== "undefined") {
              sessionStorage.setItem("scroll_emprestimos-list", String(window.scrollY));
            }
          }}
          className="absolute inset-0 z-0"
        />

        <div className="space-y-2 z-10 pointer-events-none pl-2 min-w-0 flex-1">
          <div className="flex items-center space-x-2 sm:space-x-3 flex-wrap gap-y-1 min-w-0">
            <span className="text-sm font-black text-slate-900 tracking-tight">{emp.cliente.nome}</span>
            {isPausado ? (
              <span className="flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <PauseCircle className="w-3 h-3" /> Pausado
              </span>
            ) : isQuitado ? (
              <span className="flex items-center gap-1 bg-slate-100 text-slate-500 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <CheckCircle2 className="w-3 h-3" /> Quitado
              </span>
            ) : isAtrasado ? (
              <span className="flex items-center gap-1 bg-rose-100 text-rose-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <AlertCircle className="w-3 h-3" /> {(modoCarencia || modoCarencia10) ? `Atrasado (+${emp.diasAtrasado}d)` : "Atrasado"}
              </span>
            ) : isCarencia ? (
              <span className="flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <Clock className="w-3 h-3" /> Carência (+{emp.diasAtrasado}d)
              </span>
            ) : isHoje10 ? (
              <span className="flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <Clock className="w-3 h-3" /> {emp.diasAtrasado > 0 ? `Hoje (+${emp.diasAtrasado}d)` : "Vence Hoje"}
              </span>
            ) : isVencendo ? (
              <span className="flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <Clock className="w-3 h-3" /> {emp.venceHoje ? "Vence Hoje" : "A Vencer"}
              </span>
            ) : (
              <span className="flex items-center gap-1 bg-emerald-100 text-emerald-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                Em dia
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
            <span className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-700">
              <Calendar className="w-3.5 h-3.5 opacity-70" />
              Vence em {formatData(emp.data_vencimento)}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              Investido: <span className="text-slate-700">{formatBRL(emp.principal)}</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
              Juros: <span className="text-slate-700">{Number(emp.taxa_juros)}% ({formatBRL(emp.valorJuros)})</span>
            </span>
            {Number(emp.taxa_multa) > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                Multa: <span className="text-slate-700">{Number(emp.taxa_multa)}%</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between md:justify-end gap-3 sm:gap-5 mt-2 md:mt-0 z-10 pl-2 md:pl-0 border-t md:border-t-0 border-slate-100 pt-3 md:pt-0">
          <div className="text-left md:text-right pointer-events-none flex-1">
            <div className="text-sm font-black text-slate-900 flex items-center md:justify-end gap-2">
              <span className={textColor}>{formatBRL(emp.totalEstimado)}</span>
            </div>
            <div className="text-xs font-black uppercase tracking-widest text-slate-400 mt-0.5">
              Total Estimado
            </div>
          </div>

          <div className="flex flex-row items-center gap-2 shrink-0">
            {/* Botão de Renovação Rápida (Apenas À Vista com juros configurados) */}
            {!isQuitado && emp.isAVista && emp.valorJuros > 0 && (
              <button
                onClick={(e) => openRenewModal(e, emp)}
                title="Renovar empréstimo (+30 dias)"
                className="p-2.5 sm:p-3 bg-slate-100 text-slate-400 rounded-xl hover:bg-amber-500 hover:text-white transition-all shadow-sm shrink-0 group-hover:scale-105 active:scale-90 z-20 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 pointer-events-none" />
              </button>
            )}

            {/* Botão de WhatsApp */}
            <button
              onClick={(e) => { e.preventDefault(); openWaModal(emp); }}
              className="p-2.5 sm:p-3 bg-slate-100 text-slate-400 rounded-xl hover:bg-emerald-600 hover:text-white transition-all shadow-sm shrink-0 group-hover:scale-105 active:scale-90 z-20 cursor-pointer"
            >
              <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 pointer-events-none" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Card agrupado de um cliente com 2+ empréstimos. Só tem o botão de abrir os subcards;
  // renovar e mensagem ficam disponíveis em cada subcard.
  const renderGrupo = (grupo: { clienteId: string; emprestimos: any[] }) => {
    const emps = grupo.emprestimos;
    const aberto = gruposAbertos.has(grupo.clienteId);
    const cliente = emps[0].cliente;

    const qtdAtrasados = modoCarencia10
      ? emps.filter((e) => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 10).length
      : modoCarencia
        ? emps.filter((e) => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 30).length
        : emps.filter((e) => e.estaAtrasado).length;
    const temAtrasado = qtdAtrasados > 0;
    const qtdCarencia = modoCarencia10
      ? emps.filter((e) => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 2 && e.diasAtrasado <= 10).length
      : modoCarencia
        ? emps.filter((e) => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 0 && e.diasAtrasado <= 30).length
        : 0;
    const temCarencia = qtdCarencia > 0;
    const temHoje10 = modoCarencia10 && !temCarencia && !temAtrasado && emps.some((e) => e.statusReal === "ativo" && e.status !== "pausado" && ((e.venceHoje && e.diasAtrasado === 0) || (e.diasAtrasado >= 1 && e.diasAtrasado <= 2)));
    const temVencendo = !temCarencia && !temAtrasado && (temHoje10 || emps.some((e) => e.venceHoje || e.venceEmBreve));
    const todosPausados = emps.every((e) => e.status === "pausado");
    const todosQuitados = emps.every((e) => e.statusReal === "quitado");

    let accentColor = "bg-emerald-500";
    let borderColor = "border-slate-200";
    let bgClass = "bg-white";
    let textColor = "text-emerald-600";

    if (temAtrasado) {
      accentColor = "bg-rose-500"; borderColor = "border-rose-200"; textColor = "text-rose-600";
    } else if (temCarencia) {
      accentColor = "bg-amber-500"; borderColor = "border-amber-200"; bgClass = "bg-amber-50/30"; textColor = "text-amber-700";
    } else if (todosPausados) {
      accentColor = "bg-yellow-400"; borderColor = "border-yellow-200"; bgClass = "bg-yellow-50/30"; textColor = "text-yellow-700";
    } else if (todosQuitados) {
      accentColor = "bg-slate-300"; bgClass = "bg-slate-50/50"; textColor = "text-slate-500";
    } else if (temVencendo) {
      accentColor = "bg-amber-500"; borderColor = "border-amber-200"; bgClass = "bg-amber-50/30"; textColor = "text-amber-600";
    }

    const totalGrupo = emps.reduce((acc, e) => acc + e.totalEstimado, 0);
    const investidoGrupo = emps.reduce((acc, e) => acc + e.principal, 0);
    const vencMaisAntigo = emps.reduce(
      (min, e) => (new Date(e.data_vencimento).getTime() < new Date(min).getTime() ? e.data_vencimento : min),
      emps[0].data_vencimento
    );

    return (
      <div key={`grupo-${grupo.clienteId}`} className="space-y-2">
        <div
          onClick={() => toggleGrupo(grupo.clienteId)}
          className={`group relative overflow-hidden rounded-2xl border ${borderColor} ${bgClass} p-5 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer`}
        >
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor}`} />

          <div className="space-y-2 pl-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-black text-slate-900 tracking-tight">{cliente.nome}</span>
              {temAtrasado ? (
                <span className="flex items-center gap-1 bg-rose-100 text-rose-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  <AlertCircle className="w-3 h-3" /> {qtdAtrasados === emps.length ? "Atrasado" : `${qtdAtrasados} atrasado${qtdAtrasados !== 1 ? "s" : ""}`}
                </span>
              ) : temCarencia ? (
                <span className="flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  <Clock className="w-3 h-3" /> {qtdCarencia === emps.length ? "Em Carência" : `${qtdCarencia} em carência`}
                </span>
              ) : todosPausados ? (
                <span className="flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  <PauseCircle className="w-3 h-3" /> Pausado
                </span>
              ) : todosQuitados ? (
                <span className="flex items-center gap-1 bg-slate-100 text-slate-500 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  <CheckCircle2 className="w-3 h-3" /> Quitado
                </span>
              ) : temHoje10 ? (
                <span className="flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  <Clock className="w-3 h-3" /> Hoje
                </span>
              ) : temVencendo ? (
                <span className="flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  <Clock className="w-3 h-3" /> A Vencer
                </span>
              ) : (
                <span className="flex items-center gap-1 bg-emerald-100 text-emerald-700 text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Em dia
                </span>
              )}
              <span className="flex items-center gap-1 bg-slate-800 text-white text-xs font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
                <Layers className="w-3 h-3" /> {emps.length} empréstimos
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-500">
              <span className="flex items-center gap-1.5 bg-slate-100 px-2.5 py-1 rounded-lg text-slate-700">
                <Calendar className="w-3.5 h-3.5 opacity-70" />
                Mais antigo vence em {formatData(vencMaisAntigo)}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                Investido: <span className="text-slate-700">{formatBRL(investidoGrupo)}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-5 mt-2 md:mt-0 pl-2 md:pl-0 border-t md:border-t-0 border-slate-100 pt-4 md:pt-0">
            <div className="text-left md:text-right flex-1">
              <div className="text-sm font-black text-slate-900 flex items-center md:justify-end gap-2">
                <span className={textColor}>{formatBRL(totalGrupo)}</span>
              </div>
              <div className="text-xs font-black uppercase tracking-widest text-slate-400 mt-0.5">
                Total Estimado
              </div>
            </div>

            {/* Único botão do card agrupado: abre/fecha os subcards */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleGrupo(grupo.clienteId); }}
              title={aberto ? "Fechar empréstimos do cliente" : "Ver empréstimos do cliente"}
              aria-expanded={aberto}
              className={`p-3 rounded-xl transition-all shadow-sm shrink-0 active:scale-90 cursor-pointer ${
                aberto ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
            </button>
          </div>
        </div>

        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            aberto ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden">
            <div className="ml-4 md:ml-8 pl-3 md:pl-5 border-l-2 border-slate-200 space-y-2 pt-2">
              {emps.map((emp) => renderCard(emp, true))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Contadores por categoria (usados nos badges das tabs)
  const contadores = useMemo(() => ({
    todos:        emprestimosProcessados.length,
    ativos:       emprestimosProcessados.filter(e => e.statusReal === "ativo" && !e.estaAtrasado && e.status !== "pausado").length,
    atrasados:    emprestimosProcessados.filter(e => e.estaAtrasado).length,
    atrasados_5:  emprestimosProcessados.filter(e => e.estaAtrasado && e.diasAtrasado > 5).length,
    atrasados_10: emprestimosProcessados.filter(e => e.estaAtrasado && e.diasAtrasado > 10).length,
    atrasados_15: emprestimosProcessados.filter(e => e.estaAtrasado && e.diasAtrasado > 15).length,
    atrasados_30: emprestimosProcessados.filter(e => e.estaAtrasado && e.diasAtrasado > 30).length,
    ontem:        emprestimosProcessados.filter(e => e.estaAtrasadoOntem).length,
    hoje:         emprestimosProcessados.filter(e => e.venceHoje).length,
    quitados:     emprestimosProcessados.filter(e => e.statusReal === "quitado").length,
    pausados:     emprestimosProcessados.filter(e => e.status === "pausado").length,

    // Faixas de Carência 30 dias
    carencia:     emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado <= 30).length,
    carencia_5:   emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 5 && e.diasAtrasado <= 30).length,
    carencia_10:  emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 10 && e.diasAtrasado <= 30).length,
    carencia_15:  emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 15 && e.diasAtrasado <= 30).length,
    carencia_atrasados_30: emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 30).length,

    // Faixas de Carência 10 dias (3 filtros: 1 e 2 = hoje | 2 a 10 = 10d carência | 10+ = atrasados)
    carencia10_hoje:      emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && ((e.venceHoje && e.diasAtrasado === 0) || (e.diasAtrasado >= 1 && e.diasAtrasado <= 2))).length,
    carencia10_carencia:  emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 2 && e.diasAtrasado <= 10).length,
    carencia10_atrasados: emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado > 10).length,
    carencia10_ativos:    emprestimosProcessados.filter(e => e.statusReal === "ativo" && e.status !== "pausado" && e.diasAtrasado <= 10).length,
  }), [emprestimosProcessados]);

  return (
    <div className="space-y-4">
      {/* Busca + Ordenação */}
      <div className="flex items-center gap-3">
        {/* Campo de busca */}
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearchAndReset(e.target.value)}
            placeholder="Buscar por cliente, telefone ou cidade..."
            className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-slate-900 shadow-sm"
          />
        </div>

        {/* Dropdown Combinado de Ordenação, Status Discretos e Parceiros */}
        <div className="relative self-start flex-shrink-0">
          <button
            onClick={() => { setSortOpen((prev) => !prev); }}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-600 hover:border-emerald-400 active:scale-95 transition-all shadow-sm cursor-pointer max-w-[150px] sm:max-w-none"
          >
            <ArrowUpDown className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="truncate">
              {modoCarencia10 && ["todos", "ativos", "quitados", "pausados"].includes(statusFilter)
                ? (statusFilter === "todos" ? "Todos" : statusFilter === "ativos" ? "Ativos" : statusFilter === "quitados" ? "Quitados" : "Pausados")
                : parceiroFilter !== "todos"
                  ? (parceiroFilter === "sem_parceiro" ? "Sem Parceiro" : parceirosList.find(p => p.id === parceiroFilter)?.nome || "Parceiro")
                  : sortLabels[sortOption]}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${sortOpen ? "rotate-180" : ""}`} />
          </button>

          {sortOpen && (
            <div className="absolute right-0 top-full mt-2 w-60 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden max-h-[75vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
              {/* Seção de Filtros Discretos (quando modoCarencia10 estiver ativo) */}
              {modoCarencia10 && (
                <>
                  <div className="px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50">
                    Outros Filtros
                  </div>
                  {([
                    { id: "todos" as StatusFilter,    label: `Todos (${contadores.todos})`,             icon: <Layers className="w-4 h-4" /> },
                    { id: "ativos" as StatusFilter,   label: `Ativos (${contadores.carencia10_ativos})`, icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> },
                    { id: "quitados" as StatusFilter, label: `Quitados (${contadores.quitados})`,       icon: <CheckCircle2 className="w-4 h-4 text-blue-500" /> },
                    { id: "pausados" as StatusFilter, label: `Pausados (${contadores.pausados})`,       icon: <PauseCircle className="w-4 h-4 text-yellow-500" /> },
                  ]).map((f) => {
                    const isActive = statusFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => { handleTabClick(f.id); setSortOpen(false); }}
                        className={`w-full flex items-center gap-3 px-5 py-3 text-xs font-black uppercase tracking-wider transition-colors text-left cursor-pointer ${
                          isActive
                            ? "bg-emerald-50 text-emerald-700"
                            : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <span className={isActive ? "text-emerald-500" : "text-slate-400"}>
                          {f.icon}
                        </span>
                        {f.label}
                        {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Seção de Ordenação */}
              <div className={`px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50 ${modoCarencia10 ? "border-t border-slate-100 mt-1" : ""}`}>
                Ordenação
              </div>
              {(Object.entries(sortLabels) as [SortOption, string][]).map(([key, label]) => {
                const icons: Record<SortOption, React.ReactNode> = {
                  padrao: <ArrowUpDown className="w-4 h-4" />,
                  alfabetica_az: <ArrowDownUp className="w-4 h-4 text-emerald-500" />,
                  alfabetica_za: <ArrowUpDown className="w-4 h-4 text-emerald-500" />,
                  maior_valor: <ArrowDownUp className="w-4 h-4" />,
                  menor_valor: <ArrowUpDown className="w-4 h-4" />,
                  mais_proximo: <Clock className="w-4 h-4" />,
                  mais_distante: <Calendar className="w-4 h-4" />,
                  maior_juros: <TrendingUp className="w-4 h-4 text-amber-500" />,
                  menor_juros: <TrendingUp className="w-4 h-4 text-slate-400 rotate-180" />,
                  mais_atrasados: <AlertCircle className="w-4 h-4 text-rose-500" />,
                };
                const isActive = sortOption === key;
                return (
                  <button
                    key={key}
                    onClick={() => { setSortAndReset(key as SortOption); setSortOpen(false); }}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-xs font-black uppercase tracking-wider transition-colors text-left cursor-pointer ${
                      isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className={isActive ? "text-emerald-500" : "text-slate-400"}>
                      {icons[key as SortOption]}
                    </span>
                    {label}
                    {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
                  </button>
                );
              })}

              {/* Seção de Parceiros */}
              <div className="px-4 py-2 mt-1 text-xs font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border-t border-slate-100">
                Parceiros
              </div>
              <button
                onClick={() => { setParceiroAndReset("todos"); setSortOpen(false); }}
                className={`w-full flex items-center gap-3 px-5 py-3 text-xs font-black uppercase tracking-wider transition-colors text-left cursor-pointer ${
                  parceiroFilter === "todos"
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Todos os Parceiros
                {parceiroFilter === "todos" && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
              </button>
              <button
                onClick={() => { setParceiroAndReset("sem_parceiro"); setSortOpen(false); }}
                className={`w-full flex items-center gap-3 px-5 py-3 text-xs font-black uppercase tracking-wider transition-colors text-left cursor-pointer ${
                  parceiroFilter === "sem_parceiro"
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Sem Parceiro
                {parceiroFilter === "sem_parceiro" && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
              </button>
              {parceirosList.map(p => {
                const isActive = parceiroFilter === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => { setParceiroAndReset(p.id); setSortOpen(false); }}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-xs font-black uppercase tracking-wider transition-colors text-left cursor-pointer ${
                      isActive
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {p.nome}
                    {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Filtros de Status */}
      {modoCarencia10 ? (
        /* MODO CARÊNCIA 10 DIAS: APENAS OS 3 FILTROS PRINCIPAIS (Hoje 1 e 2d | 10 Dias Carência 2 a 10d | Atrasados 10+d) */
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: "hoje"        as StatusFilter, label: "Hoje",             sublabel: "1 e 2 dias",         color: "amber",  count: contadores.carencia10_hoje },
            { id: "carencia_10" as StatusFilter, label: "10 Dias Carência", sublabel: "2 a 10 dias",        color: "orange", count: contadores.carencia10_carencia },
            { id: "atrasados"   as StatusFilter, label: "Atrasados",        sublabel: "10+ dias",           color: "rose",   count: contadores.carencia10_atrasados },
          ] as const).map((tab) => {
            const isSelected = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer relative ${
                  isSelected
                    ? tab.color === "amber"  ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                    : tab.color === "orange" ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                    :                          "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                    : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span className={`text-lg font-black leading-none ${
                  isSelected ? "text-white" :
                  tab.color === "amber"  ? "text-amber-500" :
                  tab.color === "orange" ? "text-orange-500" :
                  "text-rose-500"
                }`}>{tab.count}</span>
                <span className="font-extrabold text-[10px] sm:text-[11px] leading-tight uppercase tracking-wide truncate w-full text-center">
                  {tab.label}
                </span>
                <span className="text-[9px] leading-tight opacity-75 truncate w-full text-center">
                  {tab.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : !modoCarencia ? (
        /* MODO PADRÃO (7 cards - grade 4 colunas mobile, 7 em sm+) */
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {([
            { id: "todos"     as StatusFilter, label: "Todos",      sublabel: "Empréstimos",  color: "slate"   },
            { id: "ativos"    as StatusFilter, label: "Ativos",     sublabel: "Em dia",        color: "emerald" },
            { 
              id: "atrasados" as StatusFilter, 
              label: "Atrasados",  
              sublabel: statusFilter === "atrasados" && diasAtraso !== "0"
                ? `> ${diasAtraso} dias`
                : statusFilter === "atrasados"
                  ? "Todos (+5d)"
                  : "Todos",          
              color: "rose"    
            },
            { id: "ontem"     as StatusFilter, label: "Ontem",      sublabel: "Atrasados",     color: "orange"  },
            { id: "hoje"      as StatusFilter, label: "Hoje",       sublabel: "Vencem",         color: "amber"   },
            { id: "quitados"  as StatusFilter, label: "Quitados",   sublabel: "Pagos",          color: "blue"    },
            { id: "pausados"  as StatusFilter, label: "Pausados",   sublabel: "Acordos",        color: "yellow"  },
          ] as const).map((tab) => {
            const isSelected = statusFilter === tab.id;
            const count = tab.id === "atrasados" && diasAtraso !== "0"
              ? ((contadores as any)[`atrasados_${diasAtraso}`] ?? contadores.atrasados)
              : contadores[tab.id as keyof typeof contadores];
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                title={tab.id === "atrasados" ? "Clique repetidamente para alternar: Todos -> >5d -> >10d -> >15d -> >30d" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 rounded-xl text-xs font-bold transition-all cursor-pointer relative ${
                  isSelected
                    ? tab.color === "emerald" ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                    : tab.color === "rose"    ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                    : tab.color === "orange"  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                    : tab.color === "amber"   ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                    : tab.color === "blue"    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : tab.color === "yellow"  ? "bg-yellow-500 text-white shadow-lg shadow-yellow-500/20"
                    : "bg-slate-700 text-white shadow-lg"
                    : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span className={`text-lg font-black leading-none ${
                  isSelected ? "text-white" :
                  tab.color === "emerald" ? "text-emerald-600" :
                  tab.color === "rose"    ? "text-rose-500" :
                  tab.color === "orange"  ? "text-orange-500" :
                  tab.color === "amber"   ? "text-amber-500" :
                  tab.color === "blue"    ? "text-blue-500" :
                  tab.color === "yellow"  ? "text-yellow-600" :
                  "text-slate-600"
                }`}>{count}</span>
                <span className="font-extrabold text-[11px] leading-tight uppercase tracking-wide">{tab.label}</span>
                <span className="text-[9px] leading-tight opacity-75">{tab.sublabel}</span>
              </button>
            );
          })}
        </div>
      ) : (
        /* MODO CARÊNCIA ATIVADO: 8 CARDS COM RESPONSIVIDADE TOTAL (4x2 mobile/tablet, 8x1 desktop) */
        <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
          {([
            { id: "todos"        as StatusFilter, label: "Todos",      sublabel: "Empréstimos",       color: "slate",   count: contadores.todos },
            { id: "carencia"     as StatusFilter, label: "Carência",   sublabel: "Até 30 dias",       color: "emerald", count: contadores.carencia },
            { id: "carencia_5"   as StatusFilter, label: "+5 Dias",    sublabel: "De carência",       color: "sky",     count: contadores.carencia_5 },
            { id: "carencia_10"  as StatusFilter, label: "+10 Dias",   sublabel: "De carência",       color: "amber",   count: contadores.carencia_10 },
            { id: "carencia_15"  as StatusFilter, label: "+15 Dias",   sublabel: "De carência",       color: "orange",  count: contadores.carencia_15 },
            { id: "atrasados_30" as StatusFilter, label: "Atrasados",  sublabel: "30 dias carência",  color: "rose",    count: contadores.carencia_atrasados_30 },
            { id: "quitados"     as StatusFilter, label: "Quitados",   sublabel: "Pagos",             color: "blue",    count: contadores.quitados },
            { id: "pausados"     as StatusFilter, label: "Pausados",   sublabel: "Acordos",           color: "yellow",  count: contadores.pausados },
          ] as const).map((tab) => {
            const isSelected = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 rounded-xl text-xs font-bold transition-all cursor-pointer relative ${
                  isSelected
                    ? tab.color === "emerald" ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                    : tab.color === "sky"     ? "bg-sky-600 text-white shadow-lg shadow-sky-600/20"
                    : tab.color === "amber"   ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                    : tab.color === "orange"  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                    : tab.color === "rose"    ? "bg-rose-500 text-white shadow-lg shadow-rose-500/20"
                    : tab.color === "blue"    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : tab.color === "yellow"  ? "bg-yellow-500 text-white shadow-lg shadow-yellow-500/20"
                    : "bg-slate-700 text-white shadow-lg"
                    : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span className={`text-base sm:text-lg font-black leading-none ${
                  isSelected ? "text-white" :
                  tab.color === "emerald" ? "text-emerald-600" :
                  tab.color === "sky"     ? "text-sky-600" :
                  tab.color === "amber"   ? "text-amber-500" :
                  tab.color === "orange"  ? "text-orange-500" :
                  tab.color === "rose"    ? "text-rose-500" :
                  tab.color === "blue"    ? "text-blue-500" :
                  tab.color === "yellow"  ? "text-yellow-600" :
                  "text-slate-600"
                }`}>{tab.count}</span>
                <span className="font-extrabold text-[10px] sm:text-[11px] leading-tight uppercase tracking-wide truncate w-full text-center">
                  {tab.label}
                </span>
                <span className="text-[8px] sm:text-[9px] leading-tight opacity-75 truncate w-full text-center">
                  {tab.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Subfiltros de Atraso Cíclico (>5d, >10d, >15d, >30d) - APENAS QUANDO MODO CARÊNCIA ESTIVER DESATIVADO */}
      {!modoCarencia && !modoCarencia10 && statusFilter === "atrasados" && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 bg-rose-50/80 border border-rose-200 rounded-2xl text-xs animate-in fade-in duration-150">
          <span className="text-rose-800 font-extrabold flex items-center gap-1.5 pl-1">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            Filtro de Atraso:
          </span>
          {([
            { val: "0", label: "Todos Atrasados" },
            { val: "5", label: "> 5 dias" },
            { val: "10", label: "> 10 dias" },
            { val: "15", label: "> 15 dias" },
            { val: "30", label: "> 30 dias" },
          ] as const).map((opt) => {
            const isCurrent = diasAtraso === opt.val;
            const countOpt = opt.val === "0" ? contadores.atrasados : (contadores as any)[`atrasados_${opt.val}`];
            return (
              <button
                key={opt.val}
                type="button"
                onClick={() => { setDiasAtraso(opt.val); setCurrentPage("1"); }}
                className={`px-3 py-1 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                  isCurrent
                    ? "bg-rose-600 text-white shadow-sm font-black"
                    : "bg-white text-rose-700 hover:bg-rose-100 border border-rose-200"
                }`}
              >
                {opt.label} ({countOpt})
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-rose-500 font-semibold hidden md:inline">
            Clique no botão &quot;Atrasados&quot; para avançar no ciclo (+5d, +10d, +15d, +30d)
          </span>
        </div>
      )}

      {/* Contador de resultados */}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center flex-wrap gap-2">
          <span>
            {emprestimosFiltrados.length === grupos.length
              ? `${emprestimosFiltrados.length} empréstimo${emprestimosFiltrados.length !== 1 ? "s" : ""}`
              : `${grupos.length} cliente${grupos.length !== 1 ? "s" : ""} · ${emprestimosFiltrados.length} empréstimo${emprestimosFiltrados.length !== 1 ? "s" : ""}`}
          </span>
          {!modoCarencia && !modoCarencia10 && statusFilter === "atrasados" && diasAtraso !== "0" && (
            <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-black">
              Atrasados &gt; {diasAtraso} dias
            </span>
          )}
          {modoCarencia10 && statusFilter === "hoje" && (
            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-black">
              Hoje (0, 1 e 2 dias)
            </span>
          )}
          {modoCarencia10 && statusFilter === "carencia_10" && (
            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded-md font-black">
              10 Dias Carência (2 a 10 dias)
            </span>
          )}
          {modoCarencia10 && statusFilter === "atrasados" && (
            <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-black">
              Atrasados (10+ dias)
            </span>
          )}
          {modoCarencia10 && ["todos", "ativos", "quitados", "pausados"].includes(statusFilter) && (
            <span className="bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-black">
              Filtro: {statusFilter === "todos" ? "Todos" : statusFilter === "ativos" ? "Ativos" : statusFilter === "quitados" ? "Quitados" : "Pausados"}
            </span>
          )}
          {modoCarencia && statusFilter === "carencia_5" && (
            <span className="bg-sky-100 text-sky-800 px-2 py-0.5 rounded-md font-black">
              Carência &gt; 5 dias
            </span>
          )}
          {modoCarencia && statusFilter === "carencia_10" && (
            <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md font-black">
              Carência &gt; 10 dias
            </span>
          )}
          {modoCarencia && statusFilter === "carencia_15" && (
            <span className="bg-orange-100 text-orange-800 px-2 py-0.5 rounded-md font-black">
              Carência &gt; 15 dias
            </span>
          )}
          {modoCarencia && statusFilter === "atrasados_30" && (
            <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-black">
              Atrasados (30+ dias de carência)
            </span>
          )}
          {sortOption !== "padrao" && (
            <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md">
              Ordenado: {sortLabels[sortOption]}
            </span>
          )}
        </div>
        
        {/* Top Pagination info */}
        {totalPages > 1 && (
          <div className="text-xs text-slate-400 font-bold">
            Pág <span className="text-slate-700">{currentPageNum}</span> de {totalPages}
          </div>
        )}
      </div>

      {/* Lista de Cards Modernos */}
      <div className="space-y-3">
        {paginatedGrupos.length === 0 ? (
          <div className="p-16 text-center text-slate-500 bg-white rounded-3xl border border-slate-200 border-dashed animate-in fade-in duration-200">
            Nenhum empréstimo encontrado nesta visualização.
          </div>
        ) : (
          paginatedGrupos.map((grupo, idx) => (
            <div
              key={grupo.clienteId}
              className="animate-row-in"
              style={{ '--i': Math.min(idx, 15) } as React.CSSProperties}
            >
              {grupo.emprestimos.length === 1
                ? renderCard(grupo.emprestimos[0])
                : renderGrupo(grupo)}
            </div>
          ))
        )}
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-6 pb-4">
          <button
            onClick={() => setCurrentPage(String(Math.max(1, currentPageNum - 1)))}
            disabled={currentPageNum === 1}
            className="p-2 rounded-xl border border-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }).map((_, i) => {
              const page = i + 1;
              const isCurrent = currentPageNum === page;
              
              if (
                page === 1 || 
                page === totalPages || 
                (page >= currentPageNum - 1 && page <= currentPageNum + 1)
              ) {
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(String(page))}
                    className={`w-10 h-10 rounded-xl text-xs font-black transition-all flex items-center justify-center cursor-pointer ${
                      isCurrent 
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/20 scale-110" 
                        : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {page}
                  </button>
                );
              }
              
              if (
                (page === currentPageNum - 2 && page > 1) || 
                (page === currentPageNum + 2 && page < totalPages)
              ) {
                return <span key={page} className="px-1 text-slate-400">...</span>;
              }
              
              return null;
            })}
          </div>

          <button
            onClick={() => setCurrentPage(String(Math.min(totalPages, currentPageNum + 1)))}
            disabled={currentPageNum === totalPages}
            className="p-2 rounded-xl border border-slate-200 text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 transition-all cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Fechar dropdown ao clicar fora */}
      {sortOpen && (
        <div className="fixed inset-0 z-40" onClick={() => { setSortOpen(false); }} />
      )}
      
      {/* Modal de Confirmação de Renovação */}
      {renewModalEmp && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${
          renewClosing ? "motion-modal-backdrop-out" : "motion-modal-backdrop-in"
        }`}>
          <div className={`bg-white rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 overflow-hidden ${
            renewClosing ? "motion-modal-card-out" : "motion-modal-card-in"
          }`}>
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-amber-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                  <RefreshCw className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-sm">Renovar Empréstimo</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Receber juros e prorrogar +30 dias</p>
                </div>
              </div>
              <button
                onClick={closeRenewModal}
                disabled={isRenewing}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-700 leading-relaxed">
                Confirmar renovação do empréstimo de{" "}
                <span className="font-black text-slate-900">{renewModalEmp.cliente.nome}</span>?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-amber-700 font-semibold">Juros recebidos agora</span>
                  <span className="font-black text-amber-800">
                    {formatBRL(Number(renewModalEmp.valor_emprestado) * (Number(renewModalEmp.taxa_juros) / 100))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 font-semibold">Novo vencimento</span>
                  <span className="font-black text-slate-800">+30 dias</span>
                </div>
              </div>

              <p className="text-xs text-slate-600 font-semibold">
                Deseja enviar a confirmação da renovação no WhatsApp do cliente?
              </p>

              {renewError && (
                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-700 font-medium">{renewError}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-col gap-2">
              <button
                onClick={() => confirmRenew(true)}
                disabled={isRenewing || isPendingRenew}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-black bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {(isRenewing || isPendingRenew) ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MessageCircle className="w-4 h-4" />
                )}
                <span>{(isRenewing || isPendingRenew) ? "Renovando..." : "Sim, Renovar e Enviar no WhatsApp"}</span>
              </button>
              <button
                onClick={() => confirmRenew(false)}
                disabled={isRenewing || isPendingRenew}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-black bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-4 h-4 text-amber-600" />
                <span>Não, Renovar sem Enviar no WhatsApp</span>
              </button>
              <button
                onClick={closeRenewModal}
                disabled={isRenewing}
                className="w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Modal */}
      {waModalOpen && waSelectedEmp && (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${
          waClosing ? "motion-modal-backdrop-out" : "motion-modal-backdrop-in"
        }`}>
          <div className={`bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 flex flex-col overflow-hidden ${
            waClosing ? "motion-modal-card-out" : "motion-modal-card-in"
          }`}>
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div>
                <h3 className="font-black text-slate-900 flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-emerald-500" />
                  Enviar Mensagem
                </h3>
                <p className="text-xs text-slate-500 mt-1">Para {waSelectedEmp.cliente.nome}</p>
              </div>
              <button onClick={closeWaModal} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Respostas Rápidas</label>
                  <Link href="/configuracoes/mensagens#respostas" className="text-xs flex items-center gap-1 font-bold text-slate-400 hover:text-emerald-600 transition-colors cursor-pointer">
                    <Settings className="w-3.5 h-3.5" /> Editar modelos
                  </Link>
                </div>
                <div className="flex flex-col gap-2">
                  {waTemplates.map((msg, i) => (
                    <button key={i} onClick={() => sendWaMsg(msg)} disabled={isWaSending} className="text-left p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 hover:border-emerald-500 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                      {msg
                        .replace(/\{nome_completo\}/g, waSelectedEmp.cliente.nome)
                        .replace(/\{nome\}/g, waSelectedEmp.cliente.nome.split(" ")[0])}
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
              </div>
            </div>
            
            <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => sendWaMsg(waCustomMsg)}
                disabled={!waCustomMsg.trim() || isWaSending}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isWaSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {isWaSending ? "Enviando..." : "Enviar Mensagem"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}