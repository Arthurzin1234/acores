import pino from 'pino';

const log = pino({ base: undefined, level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' });
export const faults = {
  connection_lost: ['recoverable', 'Conexão interrompida temporariamente.'],
  restart_required: ['recoverable', 'WhatsApp solicitou reinício da conexão.'],
  logged_out: ['intervention', 'Sessão desconectada. Requer novo QR Code.'],
  invalid_session: ['intervention', 'Sessão inválida. Requer novo QR Code.'],
  forbidden: ['intervention', 'WhatsApp recusou o acesso. Verifique a conta e as permissões.'],
  replaced: ['intervention', 'Conexão substituída por outra sessão.'],
  mismatch: ['intervention', 'Dispositivo incompatível. Verifique a sessão.'],
  retry_limit: ['intervention', 'Limite de reconexões atingido. Verificação necessária.'],
  archive_sync: ['intervention', 'Não foi possível confirmar as conversas arquivadas.'],
  database_busy: ['recoverable', 'Banco temporariamente ocupado.'],
  database_failure: ['critical', 'Falha no armazenamento. Processamento pausado.'],
  credentials_storage: ['critical', 'Falha ao ler ou salvar a sessão protegida.'],
  ai_timeout: ['recoverable', 'IA indisponível ou sem resposta no prazo.'],
  ai_unavailable: ['recoverable', 'Serviço de IA indisponível.'],
  ai_rate_limit: ['recoverable', 'Limite temporário do serviço de IA.'],
  ai_auth: ['intervention', 'Credenciais ou permissões da IA recusadas.'],
  ai_config: ['intervention', 'Configuração da IA inválida.'],
  ai_response: ['intervention', 'Resposta da IA inválida.'],
  delivery_uncertain: ['intervention', 'Envio sem confirmação. Confira a conversa antes de reenviar.'],
  invalid_data: ['intervention', 'Mensagem com dados inválidos ou identificação pendente.'],
  interrupted: ['recoverable', 'Processamento interrompido antes do envio.'],
  unknown: ['intervention', 'Falha não classificada. Verificação necessária.'],
};
export function failure(code) {
  const value = Object.hasOwn(faults, code) ? code : 'unknown';
  return Object.assign(new Error(faults[value][1]), { fault: value });
}
export function classify(error) {
  let code = error?.fault;
  if (!code && [5, 6].includes(error?.errcode)) code = 'database_busy';
  if (!code && error?.code?.startsWith('ERR_SQLITE')) code = 'database_failure';
  if (!code && ['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code)) code = 'database_busy';
  if (!code && ['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error?.code)) code = 'connection_lost';
  if (!code && ['AbortError', 'TimeoutError'].includes(error?.name)) code = 'interrupted';
  if (!Object.hasOwn(faults, code)) code = 'unknown';
  return { code, classification: faults[code][0], message: faults[code][1] };
}
export function disconnectFault(code) {
  return failure(({ 401: 'logged_out', 500: 'invalid_session', 403: 'forbidden', 440: 'replaced',
    411: 'mismatch', 515: 'restart_required', 408: 'connection_lost', 428: 'connection_lost',
    503: 'connection_lost' })[code] || (code == null ? 'connection_lost' : 'unknown'));
}
export function positiveInt(value, fallback, min = 1, max = 3600000) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}
export function retryDelay(attempt, random = Math.random) {
  return Math.round(([2000, 5000, 10000, 30000][Math.min(Math.max(attempt - 1, 0), 3)]) * (0.8 + random() * 0.4));
}
export function safeLog(event, error, count = 0) {
  // Only fixed event names, classified faults and numeric counters reach logs.
  const name = ['whatsapp_fault', 'queue_fault', 'ai_fault', 'health_alert', 'server_started', 'server_stopping', 'alert_delivery_failed', 'request_error'].includes(event) ? event : 'health_alert';
  log.info({ event: name, ...(error ? classify(error) : {}), count: Number(count) || 0 });
}
