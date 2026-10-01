const normalize = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const cleanValue = (value) => String(value || "")
  .trim()
  .replace(/^[,;:.!?-]+\s*/u, "")
  .replace(/^(?:é|eh|e)\s+/iu, "")
  .replace(/^(?:o nome (?:dele|dela|do meu pet|do pet|do tutor)|meu nome|meu pet|o pet|pet|tutor|respons[aá]vel)\s*(?:é|eh|e|:|-)\s*/iu, "")
  .replace(/[.!?,]+$/u, "")
  .trim();

const validName = (value) => /^[\p{L}][\p{L}\s'-]{0,59}$/u.test(value) &&
  value.split(/\s+/u).length <= 5 &&
  !/^(nao|sim|oi|ola|nao sei|obrigad[oa])$/u.test(normalize(value));

const labeledValue = (text, pattern) => cleanValue(String(text || "").match(pattern)?.[1]);

const speciesValue = (text) => {
  const value = normalize(text);
  if (/\b(felin[ao]|gat[ao])\b/u.test(value)) return "Felina";
  if (/\b(canin[ao]|cachorr[ao]|cao|cadela)\b/u.test(value)) return "Canina";
  const other = value.match(/\b(coelho|coelha|ave|passaro|hamster|porquinho da india|tartaruga)\b/u);
  return other ? other[1] : undefined;
};

const ageValue = (text) => {
  const match = String(text || "").match(/(?:idade(?: do (?:seu )?pet)?|(?:ele|ela|o pet|meu pet)\s*(?:tem|possui))\s*(?:é|eh|e|:|-)?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(anos?|mes(?:es)?|dias?)\b/iu)
    || String(text || "").match(/\b(\d{1,2}(?:[.,]\d{1,2})?)\s*(anos?|mes(?:es)?|dias?)\b/iu);
  return match ? `${match[1]} ${match[2]}` : undefined;
};

const requestedSlotValue = (text, question) => {
  if (!/dia|hor[aá]rio|disponibilidade|retorno|melhor hora/iu.test(`${question} ${text}`)) return undefined;
  const value = String(text || "").trim();
  const labeled = value.match(/(?:melhor dia(?:\s+e\s+hor[aá]rio)?|dia|hor[aá]rio|disponibilidade|retorno)\s*(?:é|eh|e|:|-)?\s*([^,;\n]+)/iu);
  if (labeled) return cleanValue(labeled[1]);
  const slotPattern = /(hoje|amanh[ãa]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)|\b\d{1,2}[/:]\d{2}\b|\b\d{1,2}\s*h\b/iu;
  const part = positionalAnswers(value).reverse().find((item) => slotPattern.test(item));
  if (part) return part.match(slotPattern)?.[0];
  const slot = value.match(slotPattern);
  if (slot) return slot[0];
  return undefined;
};

const positionalAnswers = (text) => String(text || "")
  .split(/[\n;,]+/u)
  .map((item) => cleanValue(item))
  .filter(Boolean);

const dateValue = (text) => String(text || "").match(/(?:hoje|amanh[ãa]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/iu)?.[0];
const timeValue = (text) => String(text || "").match(/\b\d{1,2}(?::\d{2}|h(?:\d{2})?)\b/iu)?.[0];

const serviceValue = (text) => {
  const value = normalize(text);
  if (/castra/.test(value)) return { name: 'Castração', surgery: true };
  if (/cirurg/.test(value)) return { name: 'Cirurgia', surgery: true };
  if (/banho|tosa|higien/.test(value)) return { name: 'Banho e tosa', surgery: false };
  if (/vacina/.test(value)) return { name: 'Vacinação', surgery: false };
  if (/consulta|checkup|retorno/.test(value)) return { name: 'Consulta', surgery: false };
  return null;
};

export function schedulingStep(text, history = [], client = {}) {
  const currentMessage = normalize(text).trim().replace(/\s+/gu, ' ');
  if (/^(?:o+i+|ol+a+|e\s*ai|hey|hello|bom dia|boa tarde|boa noite)[!.?,\s]*$/u.test(currentMessage)) return null;
  const inbound = [...history.filter((message) => message.direction === 'inbound').map((message) => message.body), text].join('\n');
  const request = /agend|marcar|hor[aá]rio|vaga|castra|cirurg|banho|tosa|consulta|vacina|checkup|retorno/iu.test(inbound);
  if (!request) return null;
  const service = serviceValue(inbound);
  if (!service) return { reply: 'Claro! Qual atendimento você gostaria de agendar?', waitingForClient: true, category: 'geral', subject: 'Agendamento a identificar' };
  const lastQuestion = normalize([...history].reverse().find((message) => message.direction === 'outbound')?.body || '');
  const current = collectPatient(text, history, {});
  const patient = { ...client, ...current.patch };
  const registered = !!(client.pet_name || client.species || client.pet_age);
  const tutorValue = registered ? client.name : patient.name;
  const tutor = tutorValue === 'Cliente sem nome' ? null : tutorValue;
  const desiredDate = dateValue(inbound);
  const desiredTime = timeValue(inbound);
  if (service.surgery) {
    const steps = [
      ['name', tutor, 'Qual é o nome do tutor?'],
      ['pet_name', patient.pet_name, 'Qual é o nome do seu pet?'],
      ['species', patient.species, 'Qual é a espécie do seu pet?'],
      ['pet_age', patient.pet_age, 'Qual é a idade do seu pet, em meses ou anos?'],
      ['date', desiredDate, 'Qual dia você gostaria de agendar?'],
      ['time', desiredTime, 'Qual horário você prefere?'],
    ];
    const missing = steps.find(([, value]) => !value);
    if (missing) return { reply: missing[2], waitingForClient: true, category: 'cirurgia', subject: `Solicitação de ${service.name}`, surgery: true };
  } else {
    const category = service.name === 'Banho e tosa' ? 'banho_tosa' : 'consulta';
    if (!desiredDate) return { reply: 'Qual dia você gostaria de agendar?', waitingForClient: true, category, subject: `Agendamento de ${service.name}` };
    if (!desiredTime) return { reply: 'Qual horário você prefere?', waitingForClient: true, category, subject: `Agendamento de ${service.name}` };
  }
  return {
    reply: 'Pedido recebido. A recepção confirmará a disponibilidade para você.',
    complete: true,
    category: service.surgery ? 'cirurgia' : (service.name === 'Banho e tosa' ? 'banho_tosa' : 'consulta'),
    subject: `Agendamento de ${service.name}`,
    summary: `Serviço: ${service.name}. Data desejada: ${desiredDate}. Horário desejado: ${desiredTime}.`,
  };
}

export function collectPatient(text, history, client = {}) {
  const last = [...history].reverse().find((m) => m.direction === "outbound");
  const question = normalize(last?.body || "");
  const value = cleanValue(text);
  const patch = {};
  if (/\b(atendente|humano|recepcao|emergencia|urgente|socorro)\b/.test(normalize(value)))
    return { patch };
  let expected;
  if (/nome do tutor/.test(question)) expected = "name";
  else if (/nome do (seu )?pet/.test(question)) expected = "pet_name";
  else if (/especie do (seu )?pet/.test(question)) expected = "species";
  else if (/idade do (seu )?pet|idade em meses ou anos/.test(question)) expected = "pet_age";

  // A resposta pode conter vários campos: "tutor Arthur, pet Ronaldo, cachorro, 3 anos".
  // Extraímos os rótulos antes de usar a pergunta anterior como fallback.
  const tutor = labeledValue(text, /(?:nome do tutor|nome do respons[aá]vel|tutor|respons[aá]vel)\s*(?:é|eh|e|:|-)\s*([^,;\n.!?]+)/iu);
  const pet = labeledValue(text, /(?:nome do (?:seu )?pet|(?:meu )?pet)\s*(?:é|eh|e|:|-)\s*([^,;\n.!?]+)/iu);
  if (tutor && validName(tutor)) patch.name = tutor;
  if (pet && validName(pet)) patch.pet_name = pet;
  const species = speciesValue(text);
  if (species) patch.species = species;
  // The WhatsApp form is multiline, so `.` cannot be used between its labels.
  const groupedQuestion = /nome do tutor[\s\S]*esp[eé]cie[\s\S]*idade/iu.test(question);
  const age = expected === "pet_age" || /idade\s*(?:é|eh|e|:|-)/iu.test(text) || groupedQuestion
    ? ageValue(text)
    : undefined;
  if (age) patch.pet_age = age;
  const requestedSlot = requestedSlotValue(text, question);

  if (expected === "name" && !patch.name) {
    const parts = positionalAnswers(text);
    if (parts.length >= 1 && validName(parts[0])) {
      patch.name = parts[0];
    }
    if (!patch.name && groupedQuestion) {
      const firstWord = String(text || '').trim().match(/^([\p{L}][\p{L}'-]{0,59})\b/u)?.[1];
      if (firstWord && validName(firstWord)) patch.name = firstWord;
    }
    if (!patch.pet_age) {
      const numericAge = parts.find((part) => /^\d{1,2}$/u.test(part));
      if (numericAge) patch.pet_age = `${numericAge} anos`;
    }
  }

  if (Object.keys(patch).length === 0 && expected && ["name", "pet_name"].includes(expected) && validName(value))
    patch[expected] = value;
  else if (Object.keys(patch).length === 0 && expected === "species") {
    const speciesOnly = speciesValue(value);
    if (speciesOnly) patch.species = speciesOnly;
  } else if (Object.keys(patch).length === 0 && expected === "pet_age") {
    const ageOnly = ageValue(value);
    if (ageOnly) patch.pet_age = ageOnly;
    else if (/^\d{1,2}$/u.test(value)) patch.pet_age = `${value} anos`;
  }

  if (!expected && Object.keys(patch).length === 0 && !requestedSlot) return { patch };

  const updated = { ...client, ...patch };
  let nextQuestion;
  if (expected && !patch[expected] && Object.keys(patch).length === 0) nextQuestion = {
    name: "Qual é o nome do tutor?", pet_name: "Qual é o nome do seu pet?",
    species: "Qual é a espécie do seu pet?", pet_age: "Qual é a idade do seu pet, em meses ou anos?",
  }[expected];
  else if (expected === "name" && !patch.name) nextQuestion = "Qual é o nome do tutor?";
  else if (!updated.species) nextQuestion = "Qual é a espécie do seu pet?";
  else if (!updated.pet_age) nextQuestion = "Qual é a idade do seu pet, em meses ou anos?";
  return {
    patch,
    nextQuestion,
    requestedSlot,
    complete: !!(updated.name && updated.species && updated.pet_age && requestedSlot),
  };
}
