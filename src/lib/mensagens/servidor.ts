/**
 * Camada de servidor das mensagens: resolve template (banco → padrão), monta o
 * contexto a partir do banco, renderiza, envia e registra o histórico.
 *
 * NÃO tem "use server" de propósito: não deve virar endpoint. Só é importado por
 * server actions / route handlers.
 *
 * Regra de ouro: falha na camada de mensagens (tabela ainda não criada, WhatsApp
 * fora do ar, template inválido) NUNCA pode quebrar a operação de negócio
 * (pagar, renovar, criar empréstimo). Por isso tudo aqui degrada para o padrão.
 */
import { prisma } from "@/lib/db";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import { sendWhatsappMessage } from "@/lib/whatsapp";
import {
  CONFIG_PADRAO,
  RESPOSTAS_RAPIDAS_PADRAO,
  getMensagemDef,
  type ConfiguracoesBase,
  type ContextoMensagem,
} from "./catalogo";
import { formatarBRL, formatarDataUTC, primeiroNome, renderizar } from "./render";

// ─────────────────────────────────────────────────────────────────────────────
// Configurações da base
// ─────────────────────────────────────────────────────────────────────────────

export async function carregarConfiguracoes(): Promise<ConfiguracoesBase> {
  const cfg: ConfiguracoesBase = { ...CONFIG_PADRAO };
  try {
    const linhas = await prisma.configuracao.findMany({
      where: { chave: { in: ["pix_chave", "pix_titular", "empresa_nome"] } },
    });
    for (const l of linhas) {
      if (l.chave === "pix_chave") cfg.pix_chave = l.valor;
      else if (l.chave === "pix_titular") cfg.pix_titular = l.valor;
      else if (l.chave === "empresa_nome" && l.valor.trim()) cfg.empresa_nome = l.valor;
    }
  } catch (err) {
    console.error("[mensagens] Falha ao ler configurações, usando padrão:", (err as Error)?.message);
  }
  return cfg;
}

export async function carregarRespostasRapidas(): Promise<string[]> {
  try {
    const linha = await prisma.configuracao.findUnique({ where: { chave: "respostas_rapidas" } });
    if (linha) {
      const lista = JSON.parse(linha.valor);
      if (Array.isArray(lista)) return lista.filter((t) => typeof t === "string");
    }
  } catch (err) {
    console.error("[mensagens] Falha ao ler respostas rápidas, usando padrão:", (err as Error)?.message);
  }
  return [...RESPOSTAS_RAPIDAS_PADRAO];
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateResolvido {
  chave: string;
  texto: string;
  ativo: boolean;
  /** true quando o usuário editou (existe linha no banco). */
  personalizado: boolean;
}

export async function carregarTemplates(): Promise<Map<string, TemplateResolvido>> {
  const mapa = new Map<string, TemplateResolvido>();
  try {
    const linhas = await prisma.mensagemTemplate.findMany();
    for (const l of linhas) {
      mapa.set(l.chave, { chave: l.chave, texto: l.texto, ativo: l.ativo, personalizado: true });
    }
  } catch (err) {
    console.error("[mensagens] Falha ao ler templates, usando padrão:", (err as Error)?.message);
  }
  return mapa;
}

export async function resolverTemplate(
  chave: string,
  pre?: Map<string, TemplateResolvido>
): Promise<TemplateResolvido> {
  return resolverTemplateSync(chave, pre ?? (await carregarTemplates()));
}

/** Remove parágrafos que oferecem renovação (usado em empréstimos parcelados ou sem juros). */
export function removerBlocoRenovacao(texto: string): string {
  return texto
    .split(/\n\s*\n/)
    .filter(
      (bloco) =>
        !bloco.includes("{valor_renovacao}") &&
        !/renova[cç][aã]o\s+do\s+empr[eé]stimo/i.test(bloco)
    )
    .join("\n\n");
}

/** Versão síncrona: recebe o mapa já carregado (carregarTemplates). */
export function resolverTemplateSync(
  chave: string,
  mapa: Map<string, TemplateResolvido>
): TemplateResolvido {
  const def = getMensagemDef(chave);
  if (!def) throw new Error(`Mensagem desconhecida: ${chave}`);

  const salvo = mapa.get(chave);
  if (salvo && salvo.texto.trim()) {
    const textoLimpo = chave.endsWith(".parcelado")
      ? removerBlocoRenovacao(salvo.texto)
      : salvo.texto;
    return {
      chave,
      texto: textoLimpo || def.textoPadrao,
      // Mensagens que não podem ser desligadas ignoram `ativo=false`.
      ativo: def.podeDesativar ? salvo.ativo : true,
      personalizado: true,
    };
  }
  return {
    chave,
    texto: def.textoPadrao,
    ativo: salvo ? (def.podeDesativar ? salvo.ativo : true) : def.padraoAtivo,
    personalizado: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexto (variáveis) a partir do banco
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcoesContexto {
  clienteId?: string;
  emprestimoId?: string;
  /** Aceita também o id sintético `legacy-<emprestimoId>` usado na tela de Cobranças. */
  parcelaId?: string;
  /** Sobrescreve variáveis (ex.: novo_vencimento logo após uma renovação). */
  extra?: ContextoMensagem;
}

const INCLUDE_EMPRESTIMO = {
  cliente: true,
  parcelas: { orderBy: { numero: "asc" as const } },
};

export async function montarContexto(opcoes: OpcoesContexto): Promise<ContextoMensagem> {
  const { clienteId, emprestimoId, parcelaId, extra } = opcoes;
  const cfg = await carregarConfiguracoes();
  const hoje = hojeEmBrasilia();

  let emprestimo = null as Awaited<ReturnType<typeof buscarEmprestimo>>;
  let parcelaAlvo: NonNullable<typeof emprestimo>["parcelas"][number] | null = null;

  if (parcelaId && !parcelaId.startsWith("legacy-")) {
    const p = await prisma.parcela.findUnique({ where: { id: parcelaId } });
    if (p) {
      emprestimo = await buscarEmprestimo(p.emprestimo_id);
      parcelaAlvo = emprestimo?.parcelas.find((x) => x.id === p.id) ?? null;
    }
  }
  if (!emprestimo) {
    const id = emprestimoId ?? (parcelaId?.startsWith("legacy-") ? parcelaId.slice("legacy-".length) : undefined);
    if (id) emprestimo = await buscarEmprestimo(id);
  }

  const cliente =
    emprestimo?.cliente ?? (clienteId ? await prisma.cliente.findUnique({ where: { id: clienteId } }) : null);

  const ctx: ContextoMensagem = {
    pix_chave: cfg.pix_chave,
    pix_titular: cfg.pix_titular,
    empresa: cfg.empresa_nome,
  };

  if (cliente) {
    ctx.nome = primeiroNome(cliente.nome);
    ctx.nome_completo = cliente.nome;
  }

  if (emprestimo) {
    const valorEmprestado = Number(emprestimo.valor_emprestado);
    const taxa = Number(emprestimo.taxa_juros);
    const abertas = emprestimo.parcelas.filter((p) => p.status === "aberto");
    const naoRenovacao = emprestimo.parcelas.filter((p) => !p.status.includes("renovacao") && p.status !== "renovado");
    const isParcelado =
      emprestimo.tipo_pagamento === "parcelado" ||
      emprestimo.tipo_pagamento === "parcela_juros_mes" ||
      abertas.length > 1;
    const isAVista =
      !isParcelado &&
      (emprestimo.tipo_pagamento === "a_vista" ||
        emprestimo.tipo_pagamento === "a_vista_juros" ||
        emprestimo.tipo_pagamento === "juros_compostos" ||
        naoRenovacao.length <= 1);

    ctx.valor_emprestado = formatarBRL(valorEmprestado);
    ctx.valor_renovacao = isAVista && taxa > 0 ? formatarBRL(valorEmprestado * (taxa / 100)) : "";
    ctx.novo_vencimento = formatarDataUTC(emprestimo.data_vencimento);

    ctx.total_parcelas = String(isAVista ? 1 : (naoRenovacao.length || 1));
    ctx.saldo_restante = formatarBRL(abertas.reduce((acc, p) => acc + Number(p.valor), 0));

    if (!parcelaAlvo) parcelaAlvo = abertas[0] ?? emprestimo.parcelas[emprestimo.parcelas.length - 1] ?? null;

    let valorParcela: number;
    let vencimento: Date;
    let numero: number;
    if (parcelaAlvo) {
      valorParcela = Number(parcelaAlvo.valor);
      vencimento = parcelaAlvo.data_vencimento;
      numero = parcelaAlvo.numero;
    } else {
      // Empréstimo antigo sem parcelas cadastradas
      valorParcela = valorEmprestado * (1 + taxa / 100);
      vencimento = emprestimo.data_vencimento;
      numero = 1;
    }
    ctx.valor = formatarBRL(valorParcela);
    ctx.data = formatarDataUTC(vencimento);
    ctx.num = String(numero);

    const venc = new Date(Date.UTC(vencimento.getUTCFullYear(), vencimento.getUTCMonth(), vencimento.getUTCDate()));
    const dias = Math.floor((hoje.getTime() - venc.getTime()) / 86_400_000);
    ctx.dias_atraso = String(Math.max(0, dias));
  }

  return { ...ctx, ...(extra ?? {}) };
}

function buscarEmprestimo(id: string) {
  return prisma.emprestimo.findUnique({ where: { id }, include: INCLUDE_EMPRESTIMO });
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderização e envio
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoRenderEvento {
  /** false = o usuário desligou esta mensagem (não deve ser enviada). */
  ativo: boolean;
  texto: string;
  vazias: string[];
}

export interface OpcoesRender {
  /** Anexa o rodapé (Pix/renovação) — usado nas cobranças. */
  anexarRodape?: boolean;
}

export async function renderizarEvento(
  chave: string,
  contexto: ContextoMensagem,
  opcoes: OpcoesRender = {}
): Promise<ResultadoRenderEvento> {
  const templates = await carregarTemplates();
  return renderizarComTemplates(chave, contexto, templates, opcoes);
}

/** Núcleo síncrono da renderização (templates já carregados). */
export function renderizarComTemplates(
  chave: string,
  contexto: ContextoMensagem,
  templates: Map<string, TemplateResolvido>,
  opcoes: OpcoesRender = {}
): ResultadoRenderEvento {
  const tpl = resolverTemplateSync(chave, templates);
  if (!tpl.ativo) return { ativo: false, texto: "", vazias: [] };

  const valorRenovStr = (contexto.valor_renovacao ?? "").trim();
  const ehParcelado = chave.endsWith(".parcelado");
  const semRenovacao =
    ehParcelado || !valorRenovStr || /^R\$\s*0([.,]0+)?$/.test(valorRenovStr);

  const textoPrincipalBase = semRenovacao ? removerBlocoRenovacao(tpl.texto) : tpl.texto;
  const principal = renderizar(textoPrincipalBase, contexto);
  let texto = principal.texto;
  const vazias = [...principal.vazias];

  if (opcoes.anexarRodape) {
    const rodapeTpl = resolverTemplateSync("cobranca.rodape", templates);
    const usaPix = /\{pix_chave\}/.test(rodapeTpl.texto);
    const semPix = !contexto.pix_chave;
    // Sem chave Pix cadastrada, o rodapé não pode sair (ficaria "Pix: " vazio).
    if (rodapeTpl.ativo && !(usaPix && semPix)) {
      // Se o empréstimo é parcelado ou não tem juros/renovação (> 0), remove o bloco que oferece renovação
      const textoRodapeBase = semRenovacao
        ? removerBlocoRenovacao(rodapeTpl.texto)
        : rodapeTpl.texto;

      const rodape = renderizar(textoRodapeBase, contexto);
      if (rodape.texto) texto = `${texto}\n\n${rodape.texto}`;
      vazias.push(...rodape.vazias);
    }
  }

  return { ativo: true, texto, vazias };
}

/** Dados mínimos de uma parcela em cobrança (a página já os possui — evita N consultas). */
export interface DadosCobranca {
  clienteNome: string;
  numero: number;
  valor: number;
  dataVencimento: Date | string;
  totalParcelas: number;
  valorEmprestado: number;
  taxaJuros: number;
  saldoRestante: number;
  parcelaUnica?: boolean;
}

export function contextoCobranca(d: DadosCobranca, cfg: ConfiguracoesBase): ContextoMensagem {
  const hoje = hojeEmBrasilia();
  const v = new Date(d.dataVencimento);
  const venc = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const dias = Math.floor((hoje.getTime() - venc.getTime()) / 86_400_000);
  const permiteRenovacao = (d.parcelaUnica ?? d.totalParcelas <= 1) && d.taxaJuros > 0;
  return {
    nome: primeiroNome(d.clienteNome),
    nome_completo: d.clienteNome,
    valor: formatarBRL(d.valor),
    data: formatarDataUTC(d.dataVencimento),
    num: String(d.numero),
    total_parcelas: String(d.totalParcelas),
    valor_emprestado: formatarBRL(d.valorEmprestado),
    valor_renovacao: permiteRenovacao ? formatarBRL(d.valorEmprestado * (d.taxaJuros / 100)) : "",
    dias_atraso: String(Math.max(0, dias)),
    saldo_restante: formatarBRL(d.saldoRestante),
    pix_chave: cfg.pix_chave,
    pix_titular: cfg.pix_titular,
    empresa: cfg.empresa_nome,
  };
}

export interface ResultadoEnvio {
  enviado: boolean;
  /** true quando a mensagem está desligada nas configurações (não é erro). */
  ignorado?: boolean;
  erro?: string;
  /** Texto final (o que foi, ou seria, enviado). */
  texto?: string;
}

export interface OpcoesEnvio extends OpcoesRender {
  telefone: string;
  contexto: ContextoMensagem;
  clienteId?: string;
  parcelaId?: string;
}

export async function enviarPorEvento(chave: string, opcoes: OpcoesEnvio): Promise<ResultadoEnvio> {
  const { telefone, contexto, clienteId, parcelaId } = opcoes;
  try {
    const r = await renderizarEvento(chave, contexto, { anexarRodape: opcoes.anexarRodape });

    if (!r.ativo) {
      await registrarLog({ chave, telefone, clienteId, parcelaId, texto: "", status: "ignorado" });
      return { enviado: false, ignorado: true };
    }
    if (r.vazias.length > 0) {
      console.warn(`[mensagens] ${chave}: variáveis sem valor (${r.vazias.join(", ")})`);
    }
    if (!telefone) {
      return { enviado: false, erro: "Cliente sem telefone.", texto: r.texto };
    }

    const res = await sendWhatsappMessage(telefone, r.texto);
    await registrarLog({
      chave, telefone, clienteId, parcelaId, texto: r.texto,
      status: res.success ? "enviado" : "falha",
      erro: res.error,
    });
    return { enviado: res.success, erro: res.error, texto: r.texto };
  } catch (err: any) {
    const erro = err?.message || "Erro ao disparar WhatsApp";
    console.error(`[mensagens] ${chave}:`, erro);
    return { enviado: false, erro };
  }
}

/** Envia um texto livre (resposta rápida / mensagem personalizada), com variáveis. */
export async function enviarTextoLivre(
  texto: string,
  opcoes: { telefone: string; contexto: ContextoMensagem; clienteId?: string; parcelaId?: string; chave?: string }
): Promise<ResultadoEnvio> {
  const chave = opcoes.chave ?? "manual";
  try {
    const r = renderizar(texto, opcoes.contexto);
    if (!r.texto) return { enviado: false, erro: "Mensagem vazia." };
    if (!opcoes.telefone) return { enviado: false, erro: "Cliente sem telefone.", texto: r.texto };

    const res = await sendWhatsappMessage(opcoes.telefone, r.texto);
    await registrarLog({
      chave, telefone: opcoes.telefone, clienteId: opcoes.clienteId, parcelaId: opcoes.parcelaId,
      texto: r.texto, status: res.success ? "enviado" : "falha", erro: res.error,
    });
    return { enviado: res.success, erro: res.error, texto: r.texto };
  } catch (err: any) {
    return { enviado: false, erro: err?.message || "Erro ao disparar WhatsApp" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Histórico
// ─────────────────────────────────────────────────────────────────────────────

interface DadosLog {
  chave: string;
  telefone: string;
  clienteId?: string;
  parcelaId?: string;
  texto: string;
  status: "enviado" | "falha" | "ignorado";
  erro?: string;
}

export async function registrarLog(d: DadosLog): Promise<void> {
  try {
    await prisma.mensagemLog.create({
      data: {
        chave: d.chave,
        telefone: d.telefone,
        cliente_id: d.clienteId ?? null,
        // ids sintéticos (legacy-…) não são parcelas reais, mas servem para o selo "cobrado hoje"
        parcela_id: d.parcelaId ?? null,
        texto: d.texto,
        status: d.status,
        erro: d.erro ?? null,
      },
    });
  } catch (err) {
    // Histórico é "best effort": nunca derruba o envio.
    console.error("[mensagens] Falha ao gravar histórico:", (err as Error)?.message);
  }
}

/** Ids de parcelas que já receberam uma cobrança hoje (horário de Brasília). */
export async function parcelasCobradasHoje(): Promise<string[]> {
  try {
    const inicioDia = hojeEmBrasilia(); // meia-noite UTC do dia de Brasília
    // 00:00 em Brasília = 03:00 UTC (UTC-3). Margem segura: considera as últimas 24h
    // limitadas ao início do dia de Brasília.
    const desde = new Date(inicioDia.getTime() + 3 * 3_600_000);
    const logs = await prisma.mensagemLog.findMany({
      where: { chave: { startsWith: "cobranca." }, status: "enviado", criado_em: { gte: desde }, parcela_id: { not: null } },
      select: { parcela_id: true },
    });
    return [...new Set(logs.map((l) => l.parcela_id as string))];
  } catch {
    return [];
  }
}

/**
 * Data/hora (ISO) da última cobrança enviada de cada parcela. Uma única consulta
 * agrupada — usada para mostrar "Cobrado ontem às 14:32" na tela de cobranças.
 */
export async function ultimasCobrancas(parcelaIds: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (parcelaIds.length === 0) return mapa;
  try {
    const grupos = await prisma.mensagemLog.groupBy({
      by: ["parcela_id"],
      where: { chave: { startsWith: "cobranca." }, status: "enviado", parcela_id: { in: parcelaIds } },
      _max: { criado_em: true },
    });
    for (const g of grupos) {
      if (g.parcela_id && g._max.criado_em) mapa.set(g.parcela_id, g._max.criado_em.toISOString());
    }
  } catch {
    // Informação complementar: se falhar, a tela só não mostra a "última cobrança".
  }
  return mapa;
}
