import { useState } from 'react';
import { Activity, Bot, Check, CircleAlert, Clock, Database, ListOrdered, Phone, QrCode, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { Badge, Modal, PageTitle } from './ui.jsx';
import { api } from './api.js';

const when = (value) => value ? new Date(value).toLocaleString('pt-BR') : 'Ainda não registrado';
const availability = (value) => value == null ? 'Não verificado' : value ? 'Disponível' : 'Indisponível';

export function OperationsPage({ dashboard: d, run, busy }) {
  const [confirmation, setConfirmation] = useState(null);
  const health = d.operations;
  if (!health) return null;
  const wa = d.whatsapp || {}, queue = health.queue || {}, alerts = health.alerts || [];
  const facts = [
    [Phone, 'WhatsApp', wa.connected ? 'Conectado' : 'Desconectado', wa.connected],
    [Bot, 'Assistente', availability(health.ai?.available), health.ai?.available],
    [ListOrdered, 'Mensagens pendentes', queue.pending ?? 'Não verificado', queue.pending === 0],
    [Database, 'Banco de dados', availability(health.database), health.database],
  ];
  return <>
    <PageTitle title="Status do atendimento" subtitle={`Última verificação: ${when(health.checkedAt)}`}>
      <button className="secondary-button" disabled={busy} onClick={() => run(() => api.checkOperations(), 'Verificação concluída.')}>
        <RefreshCw /> Verificar agora
      </button>
    </PageTitle>
    <div className="operations-facts">
      {facts.map(([Icon, label, value, ok]) => <div key={label}>
        <Icon aria-hidden="true" /><span>{label}</span>
        <strong className={ok ? 'operation-ok' : 'operation-warning'}>{value}</strong>
      </div>)}
    </div>
    <section className="operations-section" aria-labelledby="connection-status-title">
      <div className="section-heading"><h2 id="connection-status-title"><Activity /> Conexão e recuperação</h2>
        <Badge tone={wa.connected ? 'green' : 'amber'}>{wa.mode === 'reconnecting' ? 'Reconectando' : wa.requiresNewQr ? 'Novo QR necessário' : wa.connected ? 'Conectado' : 'Desconectado'}</Badge>
      </div>
      <dl className="operations-details">
        <div><dt>Última reconexão</dt><dd>{when(wa.lastReconnectAt)}</dd></div>
        <div><dt>Tentativas de reconexão</dt><dd>{wa.attempts || 0}</dd></div>
        <div><dt>Conversas arquivadas</dt><dd>{wa.archiveSyncReady ? 'Verificadas' : 'Envios aguardando verificação'}</dd></div>
        <div><dt>Fila de entrada / saída</dt><dd>{queue.incoming ?? '?'} / {queue.outgoing ?? '?'}</dd></div>
        <div><dt>Memória</dt><dd>{health.memoryMB == null ? 'Não verificada' : `${health.memoryMB} MB`}</dd></div>
        <div><dt>Configuração</dt><dd>{availability(health.environment?.valid)}</dd></div>
      </dl>
      {wa.qrDataUrl && <img className="operations-qr" src={wa.qrDataUrl} alt="QR Code para conectar o WhatsApp" />}
      <p className="connection-event">{wa.lastEvent}</p>
      <div className="operations-actions">
        {!wa.connected && <button className="primary-button" disabled={busy || ['starting', 'reconnecting', 'qr'].includes(wa.mode)}
          onClick={() => wa.requiresNewQr ? setConfirmation({ title: 'Conectar uma nova sessão?',
            body: 'A sessão anterior está inválida. O histórico será preservado e será necessário escanear um novo QR Code.',
            action: () => api.relinkWhatsApp() }) : run(() => api.startWhatsApp(), 'Conexão solicitada.')}>
          <QrCode />{wa.requiresNewQr ? 'Gerar novo QR Code' : 'Conectar WhatsApp'}
        </button>}
        {wa.connected && <button className="secondary-button" disabled={busy} onClick={() => run(() => api.syncWhatsApp(), 'Verificação solicitada.')}>
          <ShieldCheck /> Sincronizar conversas
        </button>}
        {health.ai?.available === false && ['gemini', 'openai'].includes(health.ai.provider) &&
          <button className="secondary-button" disabled={busy} onClick={() => run(() => api.testAI(health.ai.provider), 'Assistente disponível. As conversas transferidas continuam com a recepção.')}>
            <Bot /> Verificar assistente
          </button>}
      </div>
    </section>
    <section className="operations-section" aria-labelledby="operation-alert-title">
      <div className="section-heading"><h2 id="operation-alert-title"><CircleAlert /> Alertas</h2><Badge tone={alerts.length ? 'amber' : 'green'}>{alerts.length ? `${alerts.length} ${alerts.length === 1 ? 'ativo' : 'ativos'}` : 'Sem alertas'}</Badge></div>
      {alerts.map((alert) => <div className="operations-alert" key={alert.code}>
        <CircleAlert aria-hidden="true" /><div><strong>{alert.message}</strong><small>{when(alert.last_at)}</small></div>
        <Badge tone={alert.classification === 'critical' ? 'red' : 'amber'}>{alert.classification === 'critical' ? 'Crítico' : alert.classification === 'recoverable' ? 'Recuperação em andamento' : 'Verificação necessária'}</Badge>
      </div>)}
      {!alerts.length && <p className="operations-empty">Nenhum alerta ativo.</p>}
      <p className="operations-last-error"><Clock /> Último erro: {health.lastError ? `${health.lastError.message} (${when(health.lastError.at)})` : 'Nenhum registrado'}</p>
    </section>
    {(health.reviews || []).length > 0 && <section className="operations-section" aria-labelledby="review-title">
      <div className="section-heading"><h2 id="review-title"><ListOrdered /> Envios para conferência</h2></div>
      {health.reviews.map((row) => <div className="operations-alert" key={row.id}>
        <div><strong>{row.ticket_id ? <a href={`#/conversas?ticket=${row.ticket_id}`}>Chamado #{row.ticket_id}</a> : 'Envio do WhatsApp'}</strong><small>{when(row.created_at)} · Sem confirmação de envio</small></div>
        <button className="secondary-button" disabled={busy} onClick={() => setConfirmation({ title: 'Confirmar mensagem já enviada?',
          body: 'Confirme apenas depois de conferir a conversa no WhatsApp.', action: () => api.reviewDelivery(row.id, 'sent') })}><Check /> Já foi enviada</button>
        <button className="secondary-button" disabled={busy} onClick={() => setConfirmation({ title: 'Cancelar envio pendente?',
          body: 'A mensagem não será reenviada automaticamente.', action: () => api.reviewDelivery(row.id, 'cancelled') })}><X /> Cancelar envio</button>
      </div>)}
    </section>}
    {confirmation && <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
      <p>{confirmation.body}</p><div className="form-actions">
        <button className="secondary-button" disabled={busy} onClick={() => setConfirmation(null)}>Voltar</button>
        <button className="primary-button" disabled={busy} onClick={async () => {
          if (await run(confirmation.action, 'Atualização concluída.')) setConfirmation(null);
        }}><Check /> Confirmar</button>
      </div>
    </Modal>}
  </>;
}
