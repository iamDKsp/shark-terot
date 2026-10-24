"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { enviarPorEvento, montarContexto, type OpcoesContexto } from "@/lib/mensagens/servidor";
import { formatarBRL, formatarDataUTC } from "@/lib/mensagens/render";
import { hojeEmBrasilia } from "@/lib/dateUtils";
import { calcularJurosAtraso, lerRegraAtraso } from "@/lib/jurosAtraso";

/**
 * Dispara uma mensagem de evento (template editável). Nunca lança: falha de
 * WhatsApp/mensagens não pode desfazer a operação financeira já concluída.
 */
async function dispararEvento(
  chave: string,
  ctx: OpcoesContexto,
  telefone: string,
  clienteId?: string
): Promise<{ whatsappEnviado: boolean; whatsappErro?: string; whatsappTexto?: string; whatsappIgnorado?: boolean }> {
  if (!telefone) return { whatsappEnviado: false };
  try {
    const contexto = await montarContexto({ ...ctx, clienteId });
    const r = await enviarPorEvento(chave, { telefone, contexto, clienteId, parcelaId: ctx.parcelaId });
    return {
      whatsappEnviado: r.enviado,
      whatsappErro: r.erro,
      whatsappTexto: r.texto,
      whatsappIgnorado: r.ignorado,
    };
  } catch (err: any) {
    return { whatsappEnviado: false, whatsappErro: err?.message || "Erro ao disparar WhatsApp" };
  }
}

/** Juros de atraso de uma parcela (0 se a regra do empréstimo estiver desligada ou o cliente for perdoado). */
function jurosDaParcela(
  emprestimo: { atraso_tipo?: string | null; atraso_valor?: number | null } | null | undefined,
  parcela: { valor: unknown; data_vencimento: Date },
  hoje: Date,
  cobrar: boolean
) {
  if (!cobrar || !emprestimo) return { dias: 0, juros: 0 };
  return calcularJurosAtraso(
    { tipo: emprestimo.atraso_tipo, valor: emprestimo.atraso_valor },
    Number(parcela.valor),
    parcela.data_vencimento,
    hoje
  );
}

/** Variante que descobre o telefone do cliente a partir do empréstimo. */
async function dispararEventoEmprestimo(chave: string, emprestimoId: string) {
  try {
    const emp = await prisma.emprestimo.findUnique({
      where: { id: emprestimoId },
      include: { cliente: true },
    });
    return await dispararEvento(chave, { emprestimoId }, emp?.cliente?.telefone || "", emp?.cliente?.id);
  } catch (err: any) {
    return { whatsappEnviado: false, whatsappErro: err?.message || "Erro ao disparar WhatsApp" };
  }
}

// 1. Pagar Próxima Parcela (com ou sem atraso)
export async function payNextInstallment(emprestimoId: string, withDelay: boolean, cobrarJurosAtraso = true) {
  const hoje = hojeEmBrasilia();

  // Buscar empréstimo com dados do cliente
  const emprestimo = await prisma.emprestimo.findUnique({
    where: { id: emprestimoId },
    include: { cliente: true },
  });

  // Buscar a primeira parcela em aberto ordenada por número
  const proximaParcela = await prisma.parcela.findFirst({
    where: { emprestimo_id: emprestimoId, status: "aberto" },
    orderBy: { numero: "asc" },
  });

  if (!proximaParcela) {
    throw new Error("Não há parcelas em aberto para este empréstimo.");
  }

  // Juros de atraso (por dia) calculado NO SERVIDOR; o cliente só escolhe se cobra ou perdoa.
  const atraso = jurosDaParcela(emprestimo, proximaParcela, hoje, cobrarJurosAtraso);

  // Atualizar a parcela para paga
  await prisma.parcela.update({
    where: { id: proximaParcela.id },
    data: {
      status: withDelay || atraso.juros > 0 ? "pago_com_atraso" : "pago",
      data_pagamento: hoje,
      valor_pago: atraso.juros > 0 ? Number(proximaParcela.valor) + atraso.juros : proximaParcela.valor,
    },
  });

  // Verificar se ainda existem parcelas em aberto
  const parcelasRestantes = await prisma.parcela.count({
    where: { emprestimo_id: emprestimoId, status: "aberto" },
  });

  if (parcelasRestantes === 0) {
    // Determinar se o empréstimo total teve pagamentos atrasados
    const temAtrasadas = await prisma.parcela.count({
      where: { emprestimo_id: emprestimoId, status: "pago_com_atraso" },
    });

    await prisma.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        status: temAtrasadas > 0 ? "quitado_com_atraso" : "quitado",
      },
    });
  }

  // Disparar mensagem de confirmação no WhatsApp (template editável).
  // Se esta foi a última parcela em aberto, o empréstimo foi quitado.
  const clienteTelefone = emprestimo?.cliente?.telefone || "";
  const clienteNome = emprestimo?.cliente?.nome || "";
  const wa = await dispararEvento(
    parcelasRestantes === 0 ? "pagamento.quitacao" : "pagamento.parcela",
    { emprestimoId, parcelaId: proximaParcela.id },
    clienteTelefone,
    emprestimo?.cliente?.id
  );

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return {
    success: true,
    ...wa,
    clienteNome,
  };
}

// 1b. Pagar Parcela Específica (por ID da parcela)
export async function payInstallmentById(parcelaId: string, withDelay: boolean, cobrarJurosAtraso = true, enviarWhatsapp = true) {
  const hoje = hojeEmBrasilia();

  const parcela = await prisma.parcela.findUnique({
    where: { id: parcelaId },
    include: {
      emprestimo: {
        include: { cliente: true }
      }
    }
  });

  if (!parcela) {
    throw new Error("Parcela não encontrada.");
  }

  if (parcela.status !== "aberto") {
    throw new Error("Esta parcela já foi paga.");
  }

  const emprestimoId = parcela.emprestimo_id;

  const atraso = jurosDaParcela(parcela.emprestimo, parcela, hoje, cobrarJurosAtraso);

  // Atualizar a parcela específica para paga
  await prisma.parcela.update({
    where: { id: parcelaId },
    data: {
      status: withDelay || atraso.juros > 0 ? "pago_com_atraso" : "pago",
      data_pagamento: hoje,
      valor_pago: atraso.juros > 0 ? Number(parcela.valor) + atraso.juros : parcela.valor,
    },
  });

  // Verificar se ainda existem parcelas em aberto
  const parcelasRestantes = await prisma.parcela.count({
    where: { emprestimo_id: emprestimoId, status: "aberto" },
  });

  if (parcelasRestantes === 0) {
    const temAtrasadas = await prisma.parcela.count({
      where: { emprestimo_id: emprestimoId, status: "pago_com_atraso" },
    });

    await prisma.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        status: temAtrasadas > 0 ? "quitado_com_atraso" : "quitado",
      },
    });
  }

  // Disparar mensagem de confirmação no WhatsApp (template editável).
  // Se esta foi a última parcela em aberto, o empréstimo foi quitado.
  const clienteTelefone = parcela.emprestimo?.cliente?.telefone || "";
  const clienteNome = parcela.emprestimo?.cliente?.nome || "";
  const wa = enviarWhatsapp
    ? await dispararEvento(
        parcelasRestantes === 0 ? "pagamento.quitacao" : "pagamento.parcela",
        { emprestimoId, parcelaId },
        clienteTelefone,
        parcela.emprestimo?.cliente?.id
      )
    : { whatsappEnviado: false as boolean, whatsappErro: undefined as string | undefined, whatsappTexto: undefined as string | undefined, whatsappIgnorado: undefined as boolean | undefined };

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return {
    success: true,
    ...wa,
    clienteNome,
    numeroParcela: parcela.numero,
  };
}

// 2. Quitação Total (com ou sem atraso)
export async function payFullLoan(emprestimoId: string, withDelay: boolean, cobrarJurosAtraso = true, enviarWhatsapp = true) {
  const hoje = hojeEmBrasilia();
  let clienteTelefone = "";
  let clienteNome = "";
  let totalQuitado = 0;
  let teveJurosAtraso = false;

  await prisma.$transaction(async (tx) => {
    const emp = await tx.emprestimo.findUnique({
      where: { id: emprestimoId },
      include: { cliente: true },
    });
    if (emp?.cliente) {
      clienteTelefone = emp.cliente.telefone || "";
      clienteNome = emp.cliente.nome || "";
    }

    // Atualizar todas as parcelas abertas
    const parcelasAbertas = await tx.parcela.findMany({
      where: { emprestimo_id: emprestimoId, status: "aberto" },
    });

    for (const p of parcelasAbertas) {
      const atraso = jurosDaParcela(emp, p, hoje, cobrarJurosAtraso);
      if (atraso.juros > 0) teveJurosAtraso = true;
      const valorPago = Number(p.valor) + atraso.juros;
      totalQuitado += valorPago;
      await tx.parcela.update({
        where: { id: p.id },
        data: {
          status: withDelay || atraso.juros > 0 ? "pago_com_atraso" : "pago",
          data_pagamento: hoje,
          valor_pago: atraso.juros > 0 ? valorPago : p.valor,
        },
      });
    }

    // Atualizar status do empréstimo
    await tx.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        status: withDelay || teveJurosAtraso ? "quitado_com_atraso" : "quitado",
      },
    });
  });

  // Disparar mensagem de confirmação de quitação no WhatsApp (template editável)
  const wa = enviarWhatsapp
    ? await dispararEvento(
        "pagamento.quitacao",
        { emprestimoId, extra: { valor: formatarBRL(totalQuitado) } },
        clienteTelefone
      )
    : { whatsappEnviado: false as boolean, whatsappErro: undefined as string | undefined, whatsappTexto: undefined as string | undefined, whatsappIgnorado: undefined as boolean | undefined };

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return {
    success: true,
    ...wa,
    clienteNome,
  };
}

// 3. Renegociar Dívida (Abater valores + aplicar juros opcional sobre o saldo devedor)
export async function renegociarEmprestimo(
  emprestimoId: string,
  valorAbatido: number,
  aplicarJuros: boolean,
  taxaJuros: number
) {
  const hoje = hojeEmBrasilia();

  if (valorAbatido <= 0) {
    throw new Error("O valor a ser abatido deve ser maior que zero.");
  }

  await prisma.$transaction(async (tx) => {
    // Buscar parcelas abertas do empréstimo
    const parcelasAbertas = await tx.parcela.findMany({
      where: { emprestimo_id: emprestimoId, status: "aberto" },
      orderBy: { numero: "asc" },
    });

    let restanteAbater = valorAbatido;

    for (const p of parcelasAbertas) {
      if (restanteAbater <= 0) break;

      const valorParcela = Number(p.valor);

      if (restanteAbater >= valorParcela) {
        // Paga a parcela inteira
        await tx.parcela.update({
          where: { id: p.id },
          data: {
            status: "pago",
            data_pagamento: hoje,
            valor_pago: p.valor,
          },
        });
        restanteAbater -= valorParcela;
      } else {
        // Paga parcialmente a parcela
        const novoValor = valorParcela - restanteAbater;
        await tx.parcela.update({
          where: { id: p.id },
          data: {
            valor: novoValor,
          },
        });
        restanteAbater = 0;
      }
    }

    // Buscar parcelas abertas atualizadas pós-abatimento
    const parcelasAbertasPosAbate = await tx.parcela.findMany({
      where: { emprestimo_id: emprestimoId, status: "aberto" },
      orderBy: { numero: "asc" },
    });

    if (parcelasAbertasPosAbate.length === 0) {
      // Quitou tudo
      await tx.emprestimo.update({
        where: { id: emprestimoId },
        data: { status: "quitado" },
      });
    } else {
      // Se tiver saldo restante, vamos renegociar: aplicar juros se escolhido e empurrar vencimento +1 mês
      const saldoDevedor = parcelasAbertasPosAbate.reduce((acc, p) => acc + Number(p.valor), 0);
      let jurosAdicional = 0;
      
      if (aplicarJuros && taxaJuros > 0) {
        jurosAdicional = saldoDevedor * (taxaJuros / 100);
      }

      // Distribuir o juros proporcionalmente nas parcelas abertas e empurrar data
      for (const p of parcelasAbertasPosAbate) {
        const proporcao = Number(p.valor) / saldoDevedor;
        const novoValor = Number(p.valor) + jurosAdicional * proporcao;

        const novoVencimento = new Date(p.data_vencimento);
        novoVencimento.setUTCMonth(novoVencimento.getUTCMonth() + 1);

        await tx.parcela.update({
          where: { id: p.id },
          data: {
            valor: Number(novoValor.toFixed(2)),
            data_vencimento: novoVencimento,
          },
        });
      }

      // Atualizar o vencimento global do empréstimo
      const lastParcela = parcelasAbertasPosAbate[parcelasAbertasPosAbate.length - 1];
      const novoVencGlobal = new Date(lastParcela.data_vencimento);
      novoVencGlobal.setUTCMonth(novoVencGlobal.getUTCMonth() + 1);
      
      await tx.emprestimo.update({
        where: { id: emprestimoId },
        data: { data_vencimento: novoVencGlobal }
      });
    }
  });

  // Mensagem opcional (desligada por padrão; ativável em Configurações → Mensagens)
  const wa = await dispararEventoEmprestimo("renegociacao.confirmada", emprestimoId);

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return { success: true, ...wa };
}

// 4. Reprogramar Empréstimo (Nova data de vencimento + dinheiro extra opcional + juros opcional + nova frequência)
export async function reprogramarEmprestimo(
  emprestimoId: string,
  novaDataVencimento: string,
  principalExtra: number,
  taxaJuros: number,
  frequencia: string,
  enviarWhatsapp = true
) {
  if (!novaDataVencimento) {
    throw new Error("A data de vencimento é obrigatória.");
  }

  await prisma.$transaction(async (tx) => {
    // Buscar parcelas abertas
    const parcelasAbertas = await tx.parcela.findMany({
      where: { emprestimo_id: emprestimoId, status: "aberto" },
      orderBy: { numero: "asc" },
    });

    if (parcelasAbertas.length === 0) {
      throw new Error("Não existem parcelas em aberto para reprogramar.");
    }

    let saldoDevedor = parcelasAbertas.reduce((acc, p) => acc + Number(p.valor), 0);

    // 1. Somar dinheiro extra (se houver)
    if (principalExtra > 0) {
      saldoDevedor += principalExtra;
      // Atualizar o valor emprestado do registro pai
      const empAtual = await tx.emprestimo.findUnique({ where: { id: emprestimoId } });
      if (empAtual) {
        await tx.emprestimo.update({
          where: { id: emprestimoId },
          data: {
            valor_emprestado: Number(empAtual.valor_emprestado) + principalExtra,
          },
        });
      }
    }

    // 2. Aplicar taxa de juros (se houver)
    if (taxaJuros > 0) {
      saldoDevedor = saldoDevedor * (1 + taxaJuros / 100);
    }

    // 3. Redistribuir valores nas parcelas em aberto e reprogramar datas baseado na nova frequência
    const totalParcelas = parcelasAbertas.length;
    const valorCadaParcela = Number((saldoDevedor / totalParcelas).toFixed(2));

    // Parse da data inicial em UTC para evitar offset local shifts
    const [year, month, day] = novaDataVencimento.split("-").map(Number);
    const firstDueDateUTC = new Date(Date.UTC(year, month - 1, day));

    const addPeriod = (startDate: Date, index: number, freq: string) => {
      const d = new Date(startDate.getTime());
      if (freq === "diario") {
        d.setUTCDate(d.getUTCDate() + index);
      } else if (freq === "semanal") {
        d.setUTCDate(d.getUTCDate() + index * 7);
      } else if (freq === "quinzenal") {
        d.setUTCDate(d.getUTCDate() + index * 15);
      } else if (freq === "mensal") {
        d.setUTCMonth(d.getUTCMonth() + index);
      }
      return d;
    };

    let finalDueDate = firstDueDateUTC;

    for (let i = 0; i < totalParcelas; i++) {
      const p = parcelasAbertas[i];
      const pDate = addPeriod(firstDueDateUTC, i, frequencia);
      
      if (i === totalParcelas - 1) {
        finalDueDate = pDate;
      }

      await tx.parcela.update({
        where: { id: p.id },
        data: {
          valor: valorCadaParcela,
          data_vencimento: pDate,
        },
      });
    }

    // Verificar se devemos preservar o dia-base original
    const cfg = await tx.configuracao.findUnique({
      where: { chave: "preservar_dia_base_reprogramacao" },
    });
    const empAtual = await tx.emprestimo.findUnique({ where: { id: emprestimoId } });
    let novasObservacoes = empAtual?.observacoes || undefined;
    if (cfg?.valor === "true" && empAtual) {
      const jaTemDiaBase = empAtual.observacoes && /\[DIA_BASE:\s*\d+\]/i.test(empAtual.observacoes);
      if (!jaTemDiaBase) {
        const diaBaseOriginal = new Date(empAtual.data_vencimento).getUTCDate();
        novasObservacoes = empAtual.observacoes
          ? `${empAtual.observacoes}\n[DIA_BASE: ${diaBaseOriginal}]`
          : `[DIA_BASE: ${diaBaseOriginal}]`;
      }
    }

    // 4. Atualizar o vencimento e frequência do empréstimo pai
    await tx.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        data_vencimento: finalDueDate,
        frequencia: frequencia,
        ...(novasObservacoes ? { observacoes: novasObservacoes } : {}),
      },
    });
  });

  // Mensagem opcional (desligada por padrão; ativável em Configurações → Mensagens)
  const wa = enviarWhatsapp
    ? await dispararEventoEmprestimo("reprogramacao.confirmada", emprestimoId)
    : { whatsappEnviado: false };

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return { success: true, ...wa };
}

// 5. Alternar Blacklist do Cliente
export async function toggleClientBlacklist(clientId: string, currentStatus: boolean, emprestimoId: string) {
  await prisma.cliente.update({
    where: { id: clientId },
    data: { blacklist: !currentStatus },
  });

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath(`/clientes/${clientId}`);
  revalidatePath("/clientes");
  return { success: true };
}

// 6. Excluir Empréstimo
export async function deleteLoan(id: string) {
  await prisma.emprestimo.delete({
    where: { id },
  });

  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  return { success: true, redirectUrl: "/emprestimos" };
}

// 7. Receber só os juros (Renovar +30d)
export async function receberSoJurosEmprestimo(emprestimoId: string, enviarWhatsapp = true) {
  const hoje = hojeEmBrasilia();
  let clienteTelefone = "";
  let clienteNome = "";
  let valorJurosPago = 0;
  let novoVencimentoRenovacao: Date | null = null;

  await prisma.$transaction(async (tx) => {
    // 1. Encontra o empréstimo com o cliente e as parcelas abertas
    const emprestimo = await tx.emprestimo.findUnique({
      where: { id: emprestimoId },
      include: {
        cliente: true,
        parcelas: { where: { status: "aberto" }, orderBy: { numero: "asc" } },
      },
    });

    if (!emprestimo || emprestimo.parcelas.length === 0) {
      throw new Error("Empréstimo não encontrado ou sem parcelas em aberto.");
    }

    if (
      emprestimo.tipo_pagamento === "parcelado" ||
      emprestimo.tipo_pagamento === "parcela_juros_mes" ||
      emprestimo.parcelas.length > 1
    ) {
      throw new Error("Empréstimos parcelados não possuem renovação (apenas empréstimos à vista).");
    }

    clienteTelefone = emprestimo.cliente?.telefone || "";
    clienteNome = emprestimo.cliente?.nome || "";

    // 2. Pega a primeira parcela em aberto
    const parcelaAtual = emprestimo.parcelas[0];

    // 3. Calcula juros do empréstimo (baseado no valor original emprestado)
    const valorEmprestado = Number(emprestimo.valor_emprestado);
    const taxaJuros = Number(emprestimo.taxa_juros);
    const valorJuros = valorEmprestado * (taxaJuros / 100);

    if (valorJuros <= 0) {
      throw new Error("O empréstimo não possui taxa de juros configurada para calcular o recebimento.");
    }

    // 4. Modifica a parcela atual para ser APENAS o valor dos juros, e marca como paga (renovação)
    await tx.parcela.update({
      where: { id: parcelaAtual.id },
      data: {
        valor: valorJuros,
        valor_pago: valorJuros,
        status: "pago_renovacao",
        data_pagamento: hoje,
      },
    });

    // 5. Cria uma NOVA parcela com o valor integral original (Principal + Juros)
    let novoVencimento = new Date(parcelaAtual.data_vencimento);

    // Verificar se deve preservar o dia base original
    const cfgBase = await tx.configuracao.findUnique({
      where: { chave: "preservar_dia_base_reprogramacao" },
    });

    if (cfgBase?.valor === "true") {
      let diaBase: number | null = null;
      if (emprestimo.observacoes) {
        const match = emprestimo.observacoes.match(/\[DIA_BASE:\s*(\d+)\]/i);
        if (match) diaBase = parseInt(match[1], 10);
        else {
          const matchCobrador = emprestimo.observacoes.match(/dia\s*0?(\d+)/i);
          if (matchCobrador) diaBase = parseInt(matchCobrador[1], 10);
        }
      }
      if (!diaBase) {
        const primeiraParcela = await tx.parcela.findFirst({
          where: { emprestimo_id: emprestimoId },
          orderBy: { numero: "asc" },
        });
        if (primeiraParcela) {
          diaBase = new Date(primeiraParcela.data_vencimento).getUTCDate();
        }
      }

      if (diaBase && diaBase >= 1 && diaBase <= 31) {
        const currentYear = parcelaAtual.data_vencimento.getUTCFullYear();
        const currentMonth = parcelaAtual.data_vencimento.getUTCMonth();
        let nextYear = currentYear;
        let nextMonth = currentMonth + 1;
        if (nextMonth > 11) {
          nextMonth = 0;
          nextYear += 1;
        }
        const diasNoMes = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
        const finalDay = Math.min(diaBase, diasNoMes);
        novoVencimento = new Date(Date.UTC(nextYear, nextMonth, finalDay));
      } else {
        novoVencimento.setUTCMonth(novoVencimento.getUTCMonth() + 1);
      }
    } else {
      novoVencimento.setUTCMonth(novoVencimento.getUTCMonth() + 1);
    }

    // Identificar o número da nova parcela
    const ultimaParcela = await tx.parcela.findFirst({
      where: { emprestimo_id: emprestimoId },
      orderBy: { numero: "desc" },
    });
    const novoNumero = (ultimaParcela?.numero || parcelaAtual.numero) + 1;
    const valorNovaParcela =
      emprestimo.tipo_pagamento === "a_vista" || emprestimo.tipo_pagamento === "a_vista_juros"
        ? Number((valorEmprestado + valorJuros).toFixed(2))
        : Number(parcelaAtual.valor);

    await tx.parcela.create({
      data: {
        emprestimo_id: emprestimoId,
        numero: novoNumero,
        valor: valorNovaParcela,
        data_vencimento: novoVencimento,
        status: "aberto",
      },
    });

    // 6. O vencimento global do empréstimo também deve refletir
    await tx.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        data_vencimento: novoVencimento,
      },
    });

    // Dados para as variáveis da mensagem de renovação
    valorJurosPago = valorJuros;
    novoVencimentoRenovacao = novoVencimento;
  });

  // Disparar mensagem automática no WhatsApp do cliente após a renovação (template editável)
  const wa = enviarWhatsapp
    ? await dispararEvento(
        "renovacao.confirmada",
        {
          emprestimoId,
          extra: {
            valor: formatarBRL(valorJurosPago),
            ...(novoVencimentoRenovacao ? { novo_vencimento: formatarDataUTC(novoVencimentoRenovacao) } : {}),
          },
        },
        clienteTelefone
      )
    : { whatsappEnviado: false as boolean, whatsappErro: undefined as string | undefined, whatsappTexto: undefined as string | undefined, whatsappIgnorado: undefined as boolean | undefined };

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return {
    success: true,
    ...wa,
    clienteNome,
  };
}

// 8. Editar Empréstimo Completo
export async function updateEmprestimo(emprestimoId: string, formData: FormData) {
  const clienteId    = formData.get("clienteId") as string;
  const parceiroId   = (formData.get("parceiroId") as string) || null;
  const valorEmprestado  = Number(formData.get("valorEmprestado"));
  const tipoPagamento    = formData.get("tipoPagamento") as string;
  const frequencia       = formData.get("frequencia") as string;
  const taxaJuros        = Number(formData.get("taxaJuros")) || 0;
  const regraAtraso      = lerRegraAtraso(formData);
  const taxaMulta        = regraAtraso.taxaMulta;
  const dataInicioStr    = formData.get("dataInicio") as string;
  const dataVencimentoStr= formData.get("dataVencimento") as string;
  const categoria        = formData.get("categoria") as string;
  const observacoes      = formData.get("observacoes") as string;
  const parcelasJson     = formData.get("parcelasJson") as string;
  const recriarParcelas  = formData.get("recriarParcelas") === "true";

  if (!clienteId || !valorEmprestado || !dataInicioStr || !dataVencimentoStr) {
    throw new Error("Preencha todos os campos obrigatórios.");
  }

  await prisma.$transaction(async (tx) => {
    const empAnterior = await tx.emprestimo.findUnique({
      where: { id: emprestimoId },
      include: {
        parcelas: { where: { status: "aberto" }, orderBy: { numero: "asc" } },
      },
    });

    // 1. Atualizar os dados principais do empréstimo
    await tx.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        cliente_id:       clienteId,
        parceiro_id:      parceiroId,
        valor_emprestado: valorEmprestado,
        taxa_juros:       taxaJuros,
        taxa_multa:       taxaMulta,
        juros_atraso:     taxaMulta,
        atraso_tipo:      regraAtraso.tipo,
        atraso_valor:     regraAtraso.valor,
        data_inicio:      new Date(dataInicioStr),
        data_vencimento:  new Date(dataVencimentoStr),
        tipo_pagamento:   tipoPagamento,
        frequencia:       frequencia,
        categoria:        categoria || "Sem categoria",
        observacoes:      observacoes || null,
      },
    });

    // 2. Se solicitado, recriar as parcelas abertas
    if (recriarParcelas && parcelasJson) {
      let novasParcelas: { numero: number; valor: number; data_vencimento: string }[] = [];
      try {
        novasParcelas = JSON.parse(parcelasJson);
      } catch {
        throw new Error("Erro ao processar as parcelas.");
      }

      if (novasParcelas.length > 0) {
        // Deletar apenas as parcelas em aberto (preservar pagas)
        await tx.parcela.deleteMany({
          where: { emprestimo_id: emprestimoId, status: "aberto" },
        });

        // Descobrir o maior número de parcela atual (pagas) para continuar a numeração
        const ultimaPaga = await tx.parcela.findFirst({
          where: { emprestimo_id: emprestimoId },
          orderBy: { numero: "desc" },
        });
        const offsetNumero = ultimaPaga ? ultimaPaga.numero : 0;

        // Criar novas parcelas a partir do offset
        await tx.parcela.createMany({
          data: novasParcelas.map((p, i) => ({
            emprestimo_id:   emprestimoId,
            numero:          offsetNumero + i + 1,
            valor:           p.valor,
            data_vencimento: new Date(p.data_vencimento),
            status:          "aberto",
          })),
        });
      }
    } else if (
      empAnterior &&
      empAnterior.parcelas.length === 1 &&
      (tipoPagamento === "a_vista" || tipoPagamento === "a_vista_juros")
    ) {
      // Sincroniza automaticamente a parcela única em aberto quando principal, taxa, modalidade ou vencimento mudam
      const parcelaUnica = empAnterior.parcelas[0];
      const mudouFinanceiro =
        Number(empAnterior.valor_emprestado) !== valorEmprestado ||
        Number(empAnterior.taxa_juros) !== taxaJuros ||
        empAnterior.tipo_pagamento !== tipoPagamento;

      const taxaEfetiva = tipoPagamento === "a_vista" ? 0 : taxaJuros;
      const novoValorParcela = mudouFinanceiro
        ? Number((valorEmprestado * (1 + taxaEfetiva / 100)).toFixed(2))
        : Number(parcelaUnica.valor);

      await tx.parcela.update({
        where: { id: parcelaUnica.id },
        data: {
          valor: novoValorParcela,
          data_vencimento: new Date(dataVencimentoStr),
        },
      });
    }
  });

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  return { success: true, redirectUrl: `/emprestimos/${emprestimoId}` };
}

// ── Data Prevista de Pagamento ──

/** Garante que a coluna existe no banco (idempotente). */
async function ensureColumnExists() {
  try {
    // PostgreSQL
    await prisma.$executeRaw`
      ALTER TABLE emprestimos
      ADD COLUMN IF NOT EXISTS data_prevista_pagamento DATE;
    `;
  } catch {
    try {
      // MySQL / MariaDB
      await prisma.$executeRaw`
        ALTER TABLE \`emprestimos\`
        ADD COLUMN \`data_prevista_pagamento\` DATE NULL;
      `;
    } catch (e2: any) {
      const msg = String(e2?.message ?? "");
      // 1060 = Duplicate column — coluna já existe, tudo certo
      if (!msg.includes("Duplicate column") && !msg.includes("1060") && !msg.includes("already exists")) {
        throw e2;
      }
    }
  }
}

export async function salvarDataPrevistaPagamento(
  emprestimoId: string,
  data: string | null
) {
  try {
    await prisma.emprestimo.update({
      where: { id: emprestimoId },
      data: {
        data_prevista_pagamento: data ? new Date(data) : null,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    // Se o erro for "coluna não existe", aplica a migration e tenta de novo
    if (
      msg.includes("data_prevista_pagamento") ||
      msg.includes("Unknown column") ||
      msg.includes("column") ||
      msg.includes("does not exist")
    ) {
      await ensureColumnExists();
      await prisma.emprestimo.update({
        where: { id: emprestimoId },
        data: {
          data_prevista_pagamento: data ? new Date(data) : null,
        },
      });
    } else {
      throw err;
    }
  }

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/cobrancas");
  return { success: true };
}

// ── Editar Data do Pagamento de Parcela ──
export async function atualizarDataPagamentoParcela(
  parcelaId: string,
  emprestimoId: string,
  novaDataStr: string
) {
  if (!novaDataStr) {
    throw new Error("Data de pagamento inválida.");
  }

  const [year, month, day] = novaDataStr.split("-").map(Number);
  const dataPagamentoUTC = new Date(Date.UTC(year, month - 1, day));

  await prisma.parcela.update({
    where: { id: parcelaId },
    data: {
      data_pagamento: dataPagamentoUTC,
    },
  });

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/clientes");
  return { success: true };
}

// ── Pausar / Despausar Empréstimo ──
// Um empréstimo pausado sai das cobranças e do dashboard.
// É usado quando foi feito um acordo com o cobrador.
export async function togglePausarEmprestimo(emprestimoId: string, statusAtual: string) {
  const novoStatus = statusAtual === "pausado" ? "ativo" : "pausado";

  await prisma.emprestimo.update({
    where: { id: emprestimoId },
    data: { status: novoStatus },
  });

  revalidatePath(`/emprestimos/${emprestimoId}`);
  revalidatePath("/emprestimos");
  revalidatePath("/cobrancas");
  revalidatePath("/");
  return { success: true, novoStatus };
}

