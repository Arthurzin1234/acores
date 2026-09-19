const highRiskTerms = [
  "cirurgia",
  "cirurgico",
  "cirurgica",
  "castracao",
  "castrar",
  "anestesia",
  "nodulo",
  "tumor",
  "emergencia",
  "urgencia",
  "atropel",
  "convuls",
  "sangue",
  "envenen",
  "parto",
  "nao respira",
  "sem respirar",
  "dor intensa"
];

const humanTerms = ["humano", "atendente", "recepcao", "veterinario", "medico"];

export function analyzeMessage(text) {
  const normalized = normalize(text);
  const needsHuman =
    highRiskTerms.some((term) => normalized.includes(normalize(term))) ||
    humanTerms.some((term) => normalized.includes(normalize(term)));

  if (needsHuman && normalized.includes("cirurg")) {
    return {
      category: "cirurgia",
      subject: "Solicitacao de cirurgia ou procedimento",
      priority: "alta",
      humanRequired: true,
      summary: "Cliente citou cirurgia/procedimento e precisa de avaliacao humana.",
      reply: surgeryQuestionnaire()
    };
  }

  if (needsHuman) {
    return {
      category: "urgencia",
      subject: "Atendimento com prioridade humana",
      priority: "alta",
      humanRequired: true,
      summary: "Mensagem contem sinais de urgencia ou pedido direto por atendente.",
      reply: urgentQuestionnaire()
    };
  }

  if (["banho", "tosa", "higien"].some((term) => normalized.includes(term))) {
    return {
      category: "banho_tosa",
      subject: "Pre-agendamento de banho e tosa",
      priority: "normal",
      humanRequired: false,
      summary: "Cliente quer verificar agenda de banho e tosa.",
      reply: appointmentQuestionnaire("banho e tosa")
    };
  }

  if (["vacina", "vermifugo", "consulta", "checkup", "retorno"].some((term) => normalized.includes(term))) {
    return {
      category: "consulta",
      subject: "Pre-agendamento de consulta ou vacina",
      priority: "normal",
      humanRequired: false,
      summary: "Cliente pediu orientacao para consulta, vacina ou retorno.",
      reply: appointmentQuestionnaire("consulta ou vacina")
    };
  }

  if (["preco", "valor", "orcamento", "quanto custa"].some((term) => normalized.includes(term))) {
    return {
      category: "orcamento",
      subject: "Pedido de valores ou orcamento",
      priority: "normal",
      humanRequired: false,
      summary: "Cliente quer informacoes de valores.",
      reply:
        "Posso te ajudar a levantar as informacoes para a equipe passar um valor correto. Me diga o servico desejado, especie, porte/peso do pet e se ja e cliente da loja."
    };
  }

  return {
    category: "geral",
    subject: "Nova conversa no WhatsApp",
    priority: "normal",
    humanRequired: false,
    summary: "Mensagem geral aguardando classificacao.",
    reply:
      "Obrigado pela mensagem. Para agilizar, me envie o nome do tutor, nome do pet, especie, idade e o que voce precisa hoje."
  };
}

export function buildHumanNotification(client, ticket) {
  const pet = client?.pet_name ? ` e ${client.pet_name}` : "";
  return {
    title: ticket.priority === "alta" ? "Chamado prioritario" : "Atendente solicitado",
    body: `${client?.name || "Cliente"}${pet}: ${ticket.subject}`,
    level: ticket.priority === "alta" ? "warning" : "info"
  };
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function surgeryQuestionnaire() {
  return `Vou acionar um atendente humano para acompanhar esse caso. Para adiantar o atendimento, me responda:
1. Nome do tutor
2. Nome, especie, raca, idade e peso do animal
3. Qual cirurgia ou procedimento foi indicado
4. Se ja existe exame, laudo ou encaminhamento veterinario
5. Melhor dia e horario para a equipe retornar`;
}

function urgentQuestionnaire() {
  return `Vou chamar um atendente humano agora. Enquanto isso, me envie:
1. Nome do tutor
2. Nome, especie, idade e peso do animal
3. O que aconteceu e ha quanto tempo
4. Fotos ou exames, se tiver
5. Endereco/bairro para avaliarmos deslocamento ou unidade mais proxima`;
}

function appointmentQuestionnaire(serviceName) {
  return `Consigo iniciar o pre-agendamento de ${serviceName}. Me envie o nome do tutor, nome do pet, especie, porte/idade e os melhores dias ou horarios para atendimento.`;
}
