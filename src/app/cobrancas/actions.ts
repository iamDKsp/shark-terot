"use server";

import { prisma } from "@/lib/db";
import { chaveCobranca } from "@/lib/mensagens/catalogo";
import { enviarPorEvento, montarContexto, registrarLog, renderizarEvento } from "@/lib/mensagens/servidor";

export type TipoCobranca = "atrasados" | "hoje" | "aVencer";

export interface ResultadoCobranca {
  enviado: boolean;
  /** Mensagem desligada nas configurações (não é erro). */
  ignorado?: boolean;
  erro?: string;
}

const TIPOS_PARCELA_UNICA = ["a_vista", "a_vista_juros", "juros_compostos"];
const TIPOS_PARCELADOS = ["parcelado", "parcela_juros_mes"];

/**
 * Envia UMA cobrança, no servidor: renderiza o modelo salvo (banco), anexa o
 * rodapé Pix e registra no histórico. O disparo em massa chama esta action
 * parcela por parcela (evita timeout e mostra o resultado real de cada envio).
 */
export async function enviarCobranca(parcelaId: string, tipo: TipoCobranca): Promise<ResultadoCobranca> {
  if (!["atrasados", "hoje", "aVencer"].includes(tipo)) {
    return { enviado: false, erro: "Tipo de cobrança inválido." };
  }

  const legacy = parcelaId.startsWith("legacy-");
  let emprestimoId: string | undefined;

  if (legacy) {
    emprestimoId = parcelaId.slice("legacy-".length);
  } else {
    const parcela = await prisma.parcela.findUnique({
      where: { id: parcelaId },
      select: { emprestimo_id: true, status: true },
    });
    if (!parcela) return { enviado: false, erro: "Parcela não encontrada." };
    // Segurança: não cobrar parcela que já foi paga entre carregar a tela e disparar
    if (parcela.status !== "aberto") return { enviado: false, erro: "Esta parcela não está mais em aberto." };
    emprestimoId = parcela.emprestimo_id;
  }

  const emprestimo = await prisma.emprestimo.findUnique({
    where: { id: emprestimoId },
    include: { cliente: true },
  });
  if (!emprestimo) return { enviado: false, erro: "Empréstimo não encontrado." };

  const contexto = await montarContexto({ emprestimoId, parcelaId });
  const parcelaUnica =
    !TIPOS_PARCELADOS.includes(emprestimo.tipo_pagamento) &&
    (Number(contexto.total_parcelas ?? "1") <= 1 || TIPOS_PARCELA_UNICA.includes(emprestimo.tipo_pagamento));

  const r = await enviarPorEvento(chaveCobranca(tipo, parcelaUnica), {
    telefone: emprestimo.cliente.telefone,
    contexto,
    clienteId: emprestimo.cliente_id,
    parcelaId,
    anexarRodape: true,
  });

  return { enviado: r.enviado, ignorado: r.ignorado, erro: r.erro };
}

/**
 * Registra no histórico uma cobrança feita MANUALMENTE (botão "Cobrar", que abre o
 * WhatsApp com a mensagem pronta). Não envia nada: só grava o log com status "enviado",
 * para o selo "Cobrado hoje" e a "última cobrança" refletirem também o envio manual.
 */
export async function registrarCobrancaManual(parcelaId: string, tipo: TipoCobranca): Promise<{ ok: boolean; erro?: string }> {
  if (!["atrasados", "hoje", "aVencer"].includes(tipo)) return { ok: false, erro: "Tipo de cobrança inválido." };

  const legacy = parcelaId.startsWith("legacy-");
  let emprestimoId: string | undefined;

  if (legacy) {
    emprestimoId = parcelaId.slice("legacy-".length);
  } else {
    const parcela = await prisma.parcela.findUnique({
      where: { id: parcelaId },
      select: { emprestimo_id: true },
    });
    if (!parcela) return { ok: false, erro: "Parcela não encontrada." };
    emprestimoId = parcela.emprestimo_id;
  }

  const emprestimo = await prisma.emprestimo.findUnique({
    where: { id: emprestimoId },
    include: { cliente: true },
  });
  if (!emprestimo) return { ok: false, erro: "Empréstimo não encontrado." };

  const contexto = await montarContexto({ emprestimoId, parcelaId });
  const parcelaUnica =
    !TIPOS_PARCELADOS.includes(emprestimo.tipo_pagamento) &&
    (Number(contexto.total_parcelas ?? "1") <= 1 || TIPOS_PARCELA_UNICA.includes(emprestimo.tipo_pagamento));
  const chave = chaveCobranca(tipo, parcelaUnica);
  const r = await renderizarEvento(chave, contexto, { anexarRodape: true });

  await registrarLog({
    chave,
    telefone: emprestimo.cliente.telefone,
    clienteId: emprestimo.cliente_id,
    parcelaId,
    texto: r.texto,
    status: "enviado",
  });
  return { ok: true };
}
