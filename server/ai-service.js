import { analyzeMessage } from "./ai.js";
import { requestDecision } from "./ai-providers.js";
import { createHash } from 'node:crypto';
import { classify, failure, positiveInt, safeLog } from './reliability.js';

export const AI_UNAVAILABLE_REPLY = 'Olá! No momento vou chamar um atendente humano para continuar seu atendimento 😉';

export const QUESTIONS = {
  tutor: "Qual é o nome do tutor?",
  pet: "Qual é o nome do seu pet?",
  species: "Qual é a espécie do seu pet?",
  age: "Qual é a idade do seu pet?",
  procedure: "Qual procedimento foi indicado pelo veterinário?",
  referral: "Você já possui encaminhamento ou exames para esse procedimento?",
  availability: "Qual dia e horário você prefere para o retorno da recepção?",
  need: "Como podemos ajudar você e seu pet hoje?",
};
const HANDOFF =
  "A recepção vai confirmar essa informação e continuar o atendimento.";
const normalized = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function approvedCatalog(settings, knowledge) {
  const items = knowledge.map((item) => ({ ...item }));
  if (settings.address?.trim())
    items.push({
      id: "clinic_address",
      question: 'Qual é o endereço da clínica?',
      answer: `Endereço cadastrado: ${settings.address.trim()}`,
    });
  if (settings.phone?.trim())
    items.push({
      id: "clinic_phone",
      question: 'Qual é o telefone da clínica?',
      answer: `Telefone cadastrado: ${settings.phone.trim()}`,
    });
  return items;
}

export function renderDecision(
  decision,
  { text, history = [], settings = {}, knowledge = [] },
) {
  const rule = analyzeMessage(text);
  const clinical = /cirurg|castra|anestes|nodulo|tumor/.test(normalized(text));
  const medical =
    /diagnostic|medicamento|remedio|dosagem|qual dose|tratamento|sintoma|vomit|diarre|sangra|convuls|respira|envenen/.test(
      normalized(text),
    );
  let intent = decision.intent;
  if (rule.humanRequired)
    intent = clinical
      ? "surgery"
      : /humano|atendente|recepcao|veterinario|medico/.test(normalized(text))
        ? "human"
        : "emergency";
  if (medical && !["surgery", "emergency"].includes(intent)) intent = "human";
  if (/emergencia|urgencia|atropel|convuls|envenen|nao respira|sem respirar|dor intensa/.test(normalized(text)))
    intent = "emergency";
  const catalog = approvedCatalog(settings, knowledge);
  const question = QUESTIONS[decision.question];
  const announced = history.some((m) => m.direction === "outbound" &&
    /encaminhar|recepção.*continu|recepção.*confirm/i.test(m.body));
  const base = {
    category: "geral",
    subject: "Atendimento da recepção",
    priority: "normal",
    humanRequired: false,
    summary: "Mensagem classificada conforme o padrão de atendimento.",
  };
  if (intent === "emergency")
    return {
      ...base,
      category: "urgencia",
      subject: "Solicitação prioritária à recepção",
      priority: "alta",
      humanRequired: true,
      handoffComplete: false,
      summary: "Mensagem requer atendimento humano prioritário.",
      reply:
        `${settings.is24Hours === false ? '' : 'Atendemos 24 horas. '}${settings.address?.trim() ? `Endereço: ${settings.address.trim()}.\nMaps: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address.trim())}\n` : "A recepção confirmará o endereço. "}Vou acionar a recepção com prioridade. Não espere concluir o cadastro para buscar atendimento.\nQual é o nome do tutor?`,
    };
  if (intent === "human")
    return {
      ...base,
      humanRequired: true,
      subject: "Atendente solicitado",
      handoffComplete: true,
      reply:
        "Vou encaminhar você à recepção. Aguarde o atendimento, por favor.",
    };
  if (intent === "surgery")
    return {
      ...base,
      category: "cirurgia",
      subject: "Solicitação de cirurgia",
      priority: "alta",
      humanRequired: true,
      summary:
        "Solicitação cirúrgica encaminhada à recepção. Procedimento e agenda dependem de confirmação humana.",
      handoffComplete: !question,
      reply: question
        ? `${announced ? "" : "Vou encaminhar o caso à recepção. "}${question}`
        : "Tudo certo. A recepção continuará seu atendimento.",
    };
  if (intent === "information") {
    const fact = catalog.find((item) => item.id === decision.answerId);
    if (fact && !decision.needsHuman)
      return {
        ...base,
        subject: "Informação cadastrada da clínica",
        summary: `Resposta aprovada consultada: ${fact.question}`,
        reply: fact.answer,
      };
  }
  if (intent === "greeting" && !decision.needsHuman)
    return {
      ...base,
      reply: `Olá! Sou o assistente virtual do ${settings.name || "Centro Veterinário dos Açores"}. ${QUESTIONS.need}`,
    };
  if (intent === "appointment")
    return {
      ...base,
      category: rule.category === "banho_tosa" ? "banho_tosa" : "consulta",
      subject: "Solicitação de agendamento",
      humanRequired: decision.needsHuman || !question,
      summary:
        "Solicitação de agendamento. Nenhum horário confirmado automaticamente.",
      handoffComplete: !question,
      reply: question
        ? `${announced ? "" : "A recepção confirmará a disponibilidade. "}${question}`
        : "Tudo certo. A recepção continuará seu atendimento.",
    };
  return {
    ...base,
    humanRequired: true,
    subject: "Informação pendente de confirmação",
    summary:
      "Sem resposta aprovada para a solicitação; atendimento humano necessário.",
    reply: HANDOFF,
    handoffComplete: true,
  };
}

export function createAIService(
  config,
  getSettings,
  providerRequest = requestDecision,
  { timeoutMs = positiveInt(process.env.AI_TIMEOUT_MS, 12000, 100, 60000), now = Date.now } = {},
) {
  let runtime = { provider: "rules", available: null, lastError: null, lastUsedAt: null };
  let checks = {};
  let blockedUntil = 0, fingerprint = '', checking;
  const probeInterval = positiveInt(process.env.AI_HEALTH_INTERVAL_MS, 300000, 30000);
  async function request(provider, input, signal, force = false) {
    let credentials;
    try { credentials = config.credentials(provider); } catch {
      runtime = { provider, available: false, lastError: failure('ai_config').message, errorCode: 'ai_config', classification: 'intervention', lastUsedAt: new Date(now()).toISOString() };
      blockedUntil = Infinity; throw failure('ai_config');
    }
    const current = createHash('sha256').update(`${provider}:${credentials.model}:${credentials.key}`).digest('hex');
    if (current !== fingerprint || force) { fingerprint = current; blockedUntil = 0; }
    if (now() < blockedUntil) throw failure(runtime.errorCode || 'ai_unavailable');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer, abort;
    try {
      if (!credentials.key) throw failure('ai_config');
      const deadline = new Promise((_, reject) => {
        abort = () => reject(failure(signal?.aborted ? 'interrupted' : 'ai_timeout'));
        combined.addEventListener('abort', abort, { once: true });
        if (combined.aborted) abort();
        timer = setTimeout(() => controller.abort(), timeoutMs);
      });
      const result = await Promise.race([providerRequest({ provider, ...credentials, ...input, signal: combined }), deadline]);
      runtime = { provider, available: true, lastError: null, errorCode: null, lastUsedAt: new Date(now()).toISOString() };
      blockedUntil = 0;
      return result;
    } catch (error) {
      if (signal?.aborted) throw failure('interrupted');
      const fault = classify(error?.fault ? error : failure('ai_unavailable'));
      blockedUntil = fault.classification === 'recoverable' ? now() + 30000 : Infinity;
      runtime = { provider, available: false, lastError: fault.message, errorCode: fault.code,
        classification: fault.classification, lastUsedAt: new Date(now()).toISOString() };
      safeLog('ai_fault', failure(fault.code));
      throw failure(fault.code);
    } finally { clearTimeout(timer); combined.removeEventListener('abort', abort); }
  }
  const unavailable = () => ({ category: 'geral', subject: 'IA indisponível', priority: 'alta',
    humanRequired: true, handoffComplete: true, aiUnavailable: true, summary: 'IA indisponível',
    reply: AI_UNAVAILABLE_REPLY, aiProvider: config.snapshot().provider });
  return {
    snapshot: () => ({ ...runtime, checks: { ...checks } }),
    resetChecks() {
      checks = {}; blockedUntil = 0;
    },
    async analyze(text, history = [], signal) {
      const saved = config.snapshot();
      const settings = getSettings();
      const rule = analyzeMessage(text);
      let decision = {
        intent: "other",
        answerId: "",
        question: "tutor",
        needsHuman: true,
      };
      if (rule.humanRequired)
        decision.intent = /cirurg|castra|anestes|nodulo|tumor/.test(
          normalized(text),
        )
          ? "surgery"
          : "human";
      else if (["consulta", "banho_tosa"].includes(rule.category))
        decision = { ...decision, intent: "appointment", needsHuman: false };
      else if (
        /^(oi|ola|bom dia|boa tarde|boa noite|obrigad[oa])[!.?\s]*$/.test(
          normalized(text),
        )
      )
        decision = {
          ...decision,
          intent: "greeting",
          question: "need",
          needsHuman: false,
        };
      if (saved.provider !== "rules") {
        try {
          decision = await request(saved.provider, {
            text,
            history,
            knowledge: approvedCatalog(settings, saved.knowledge),
          }, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          return unavailable();
        }
      } else {
        runtime = {
          provider: "rules",
          available: true,
          lastError: null,
          lastUsedAt: new Date().toISOString(),
        };
        const exact = approvedCatalog(settings, saved.knowledge).find(
          (item) =>
            normalized(item.question).trim() === normalized(text).trim(),
        );
        if (exact)
          decision = {
            intent: "information",
            answerId: exact.id,
            question: "none",
            needsHuman: false,
          };
      }
      return {
        ...renderDecision(decision, {
          text,
          history,
          settings: getSettings(),
          knowledge: config.snapshot().knowledge,
        }),
        aiProvider: runtime.provider,
      };
    },
    async health() {
      const provider = config.snapshot().provider;
      if (provider === 'rules') { runtime = { ...runtime, available: true, provider: 'rules', lastError: null }; return runtime; }
      if (checking) return checking;
      if (now() < blockedUntil || (runtime.lastUsedAt && now() - Date.parse(runtime.lastUsedAt) < probeInterval)) return runtime;
      checking = request(provider, { text: 'Olá', history: [], knowledge: [] })
        .catch(() => undefined).finally(() => { checking = null; });
      await checking;
      return runtime;
    },
    async test(provider) {
      const credentials = config.credentials(provider);
      try {
        await request(provider, {
          text: "Olá",
          history: [],
          knowledge: [],
        }, undefined, true);
        checks[provider] = {
          ok: true,
          message: "Conexão confirmada",
          at: new Date().toISOString(),
        };
        return { ok: true, provider, model: credentials.model };
      } catch (error) {
        checks[provider] = {
          ok: false,
          message: error.message,
          at: new Date().toISOString(),
        };
        throw error;
      }
    },
  };
}
