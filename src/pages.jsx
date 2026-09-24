import { useContext, useEffect, useRef, useState } from "react";
import { Identity } from './identity.js';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Baby,
  Bell,
  Bot,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Heart,
  ListFilter,
  MessageCircle,
  MoreHorizontal,
  PawPrint,
  Pencil,
  Phone,
  Plus,
  QrCode,
  Save,
  Scissors,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Stethoscope,
  UserRound,
  Users,
  Trash2,
  Play,
  Pause,
} from "lucide-react";
import { api } from "./api.js";
import AISettings from "./AISettings.jsx";
import {
  activeTicket,
  Badge,
  checklistLabels,
  ClientSelect,
  dateLabel,
  Empty,
  Field,
  localDate,
  matches,
  Metric,
  Modal,
  PageTitle,
  PetAvatar,
  Section,
  serviceLabels,
  statusLabels,
  timeLabel,
} from "./ui.jsx";

export function MessageText({ text }) {
  return String(text || "").split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part)
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere", textDecoration: "underline", color: "inherit" }}>{part.includes("google.com/maps/") ? "Abrir no Google Maps" : part}</a>
      : part);
}

function DeleteButton({ entity, id, label, warning = "Esta ação não pode ser desfeita.", run, busy, onDeleted }) {
  const identity = useContext(Identity);
  const [open, setOpen] = useState(false);
  if (identity.role !== 'administrador') return null;
  async function remove() {
    if (await run(() => api.deleteRecord(entity, id), "Registro excluído.")) {
      setOpen(false);
      onDeleted?.();
    }
  }
  return <>
    <button className="delete-action" title={`Excluir ${label}`} aria-label={`Excluir ${label}`} disabled={busy} onClick={() => setOpen(true)}><Trash2 /><span>Excluir</span></button>
    {open && <div className="delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><div className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title"><div className="delete-icon"><Trash2 /></div><h2 id="delete-title">Excluir {label}?</h2><p>{warning}</p><div className="delete-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cancelar</button><button className="delete-confirm" disabled={busy} onClick={remove}><Trash2 />Excluir definitivamente</button></div></div></div>}
  </>;
}

export function HomePage(props) {
  const { dashboard: d } = props;
  const today = localDate();
  const conversationsToday = d.tickets.filter(
    (t) => localDate(new Date(t.created_at)) === today,
  );
  const appointments = (d.appointments || []).filter(
    (a) => a.scheduled_at.startsWith(today) && a.status !== "cancelado",
  );
  const surgeries = d.tickets.filter(
    (t) => t.category === "cirurgia" && activeTicket(t),
  );
  const care = (d.neonatal || []).filter((n) => n.status !== "alta");
  const notifications = d.notifications.filter((n) => !n.read_at);
  const recent = [...d.tickets]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  return (
    <>
      <div className="home-intro">
        <div className="greeting">
          <span className="eyebrow">{d.settings?.name || 'Sua central de atendimento'}</span>
          <h1>Olá, equipe!</h1>
          <p>Um novo dia para cuidar de quem faz parte da família.</p>
        </div>
        <div className="date-display">
          <CalendarDays />
          <div>
            <strong>
              {new Date().toLocaleDateString("pt-BR", {
                weekday: "long",
                day: "2-digit",
                month: "long",
              })}
            </strong>
            <span>Vamos cuidar juntos.</span>
          </div>
        </div>
        <div className="welcome-pets">
          <img
            src="/assets/pets-acores.png"
            alt="Cachorro golden retriever e gato lado a lado"
          />
          <span>
            Mais cuidado.
            <br />
            <strong>Mais vida.</strong>
            <Heart />
          </span>
        </div>
      </div>
      <div className="metrics-grid">
        <Metric
          icon={MessageCircle}
          value={conversationsToday.length}
          label="Conversas hoje"
          detail={`${d.tickets.filter(activeTicket).length} em aberto`}
          tone="violet"
          href="#/conversas"
        />
        <Metric
          icon={CalendarDays}
          value={appointments.length}
          label="Agendamentos hoje"
          detail={`${appointments.filter((a) => a.status === "confirmado").length} confirmados`}
          tone="green"
          href="#/agendamentos"
        />
        <Metric
          icon={Scissors}
          value={surgeries.length}
          label="Solicitações de cirurgia"
          detail={`${surgeries.filter((t) => t.status === "novo").length} aguardando atendimento`}
          tone="rose"
          href="#/cirurgias"
        />
        <Metric
          icon={Baby}
          value={care.length}
          label="Neonatos em acompanhamento"
          detail={`${care.filter((n) => n.status === "estavel").length} estáveis`}
          tone="amber"
          href="#/neonatos"
        />
      </div>
      <div className="home-grid">
        <div className="home-main">
          <Section
            title="Conversas recentes"
            link={{ href: "#/conversas", label: "Ver todas" }}
            className="recent-section"
          >
            <div className="recent-list">
              {recent.length ? (
                recent.map((t) => (
                  <a
                    href={`#/conversas?id=${t.id}`}
                    key={t.id}
                    className="recent-row"
                  >
                    <PetAvatar species={t.species} name={t.pet_name} />
                    <div className="recent-info">
                      <strong>{t.client_name || t.phone}</strong>
                      <span>
                        {t.pet_name || "Pet não informado"}
                        {t.species && ` · ${t.species}`}
                      </span>
                      <p>{t.subject}</p>
                    </div>
                    <div className="recent-meta">
                      <time>{timeLabel(t.updated_at)}</time>
                      <Badge value={t.status} />
                    </div>
                  </a>
                ))
              ) : (
                <Empty title="Nenhuma conversa recebida" icon={MessageCircle} />
              )}
            </div>
            <a className="section-bottom-link" href="#/conversas">
              <MessageCircle /> Abrir central de conversas
              <ArrowRight />
            </a>
          </Section>
          <Section
            title="Tarefas e alertas"
            badge={notifications.length}
            link={{ href: "#/notificacoes", label: "Ver todos" }}
            className="alerts-section"
          >
            <div className="alert-list">
              {notifications.length ? (
                notifications.slice(0, 4).map((n) => (
                  <a
                    key={n.id}
                    href={
                      n.ticket_id
                        ? `#/conversas?id=${n.ticket_id}`
                        : "#/notificacoes"
                    }
                    className={`alert-row ${n.level === "warning" ? "rose" : "violet"}`}
                  >
                    <span className="alert-icon">
                      {n.level === "warning" ? <Scissors /> : <Bell />}
                    </span>
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.body}</p>
                      <small>
                        {dateLabel(n.created_at)} · {timeLabel(n.created_at)}
                      </small>
                    </div>
                    <ChevronRight />
                  </a>
                ))
              ) : (
                <Empty icon={CheckCheck} title="Tudo em dia por aqui" />
              )}
              {!d.whatsapp?.connected && (
                <a href="#/configuracoes" className="alert-row amber">
                  <span className="alert-icon">
                    <QrCode />
                  </span>
                  <div>
                    <strong>Conectar o WhatsApp</strong>
                    <p>Conexão da clínica pendente</p>
                  </div>
                  <ChevronRight />
                </a>
              )}
            </div>
          </Section>
          <Section
            title="Agendamentos de hoje"
            link={{ href: "#/agendamentos", label: "Ver agenda" }}
          >
            <AppointmentRows appointments={appointments.slice(0, 4)} />
            <a className="section-bottom-link" href="#/agendamentos?novo=1">
              <Plus /> Novo agendamento
              <ArrowRight />
            </a>
          </Section>
          <Section
            title="Pacientes em acompanhamento"
            link={{ href: "#/neonatos", label: "Ver todos" }}
          >
            {care.length ? (
              <div className="care-list">
                {care.slice(0, 4).map((n) => (
                  <a href="#/neonatos" className="care-row" key={n.id}>
                    <PetAvatar species={n.species} small />
                    <div>
                      <strong>{n.pet_name || "Pet sem nome"}</strong>
                      <span>{n.client_name}</span>
                    </div>
                    <Badge value={n.status} />
                  </a>
                ))}
              </div>
            ) : (
              <Empty
                icon={Heart}
                title="Nenhum acompanhamento ativo"
                action={
                  <a href="#/neonatos" className="text-button">
                    Ver neonatos <ArrowRight />
                  </a>
                }
              />
            )}
          </Section>
        </div>
      </div>
    </>
  );
}


function AppointmentRows({ appointments }) {
  return appointments.length ? (
    <div className="appointment-list">
      {appointments.map((a) => (
        <a
          className="appointment-row"
          key={a.id}
          href={`#/agendamentos?data=${a.scheduled_at.slice(0, 10)}`}
        >
          <time>{timeLabel(a.scheduled_at)}</time>
          <div>
            <strong>
              {serviceLabels[a.service]} · {a.pet_name || "Pet"}
            </strong>
            <span>{a.professional || a.client_name}</span>
          </div>
          <Badge value={a.status} />
        </a>
      ))}
    </div>
  ) : (
    <Empty icon={CalendarDays} title="Agenda livre por enquanto" />
  );
}

export function ConversationsPage({
  dashboard: d,
  route,
  busy,
  run,
  go,
  notify,
  clinical = true,
}) {
  const [query, setQuery] = useState(route.params.get('q') || '');
  const [filter, setFilter] = useState(route.params.has('q') ? 'todas' : 'abertas');
  const [conversation, setConversation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reply, setReply] = useState("");
  const list = useRef(null);
  const requestVersion = useRef(0);
  const selectedId = Number(route.params.get("id")) || null;
  const filtered = d.tickets.filter(
    (t) =>
      (filter === "todas" ||
        (filter === "humana"
          ? t.human_required && activeTicket(t)
          : activeTicket(t))) &&
      matches(query, t.client_name, t.pet_name, t.id, t.phone),
  );
  const ticket = selectedId
    ? d.tickets.find((t) => t.id === selectedId)
    : filtered[0];
  useEffect(() => {
    if (!ticket) {
      setConversation(null);
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    api
      .ticketMessages(ticket.id)
      .then((payload) => {
        if (version === requestVersion.current) setConversation(payload);
      })
      .catch((err) => {
        if (version === requestVersion.current) setLoadError(err.message);
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
    return () => {
      requestVersion.current++;
    };
  }, [ticket?.id, ticket?.updated_at]);
  useEffect(() => {
    setReply("");
  }, [ticket?.id]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [conversation]);
  async function send(event) {
    event.preventDefault();
    if (!reply.trim() || !ticket) return;
    const result = await run(
      () =>
        api.sendTicketMessage(ticket.id, {
          body: reply.trim(),
          author: ticket.assigned_to || "Recepção",
          sendToWhatsApp: ticket.source !== "simulador",
        }),
      (result) =>
        result.delivery.delivered
          ? "Mensagem enviada pelo WhatsApp."
          : "Mensagem salva no painel; não enviada ao WhatsApp.",
    );
    if (result) setReply("");
  }
  return (
    <>
      <PageTitle
        title="Conversas"
        subtitle={`${d.tickets.filter(activeTicket).length} atendimentos abertos · ${d.tickets.filter((t) => t.human_required && activeTicket(t)).length} aguardando a equipe`}
      />
      <div
        className={`conversations-layout ${selectedId ? "has-selection" : ""}`}
      >
        <section className="conversation-queue">
          <div className="queue-controls">
            <div className="input-search">
              <Search />
              <input
                placeholder="Buscar conversa…"
                aria-label="Buscar conversa"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div
              className="segmented"
              role="group"
              aria-label="Filtrar conversas"
            >
              {[
                ["abertas", "Abertas"],
                ["humana", "Fila humana"],
                ["todas", "Todas"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  className={filter === value ? "selected" : ""}
                  onClick={() => {
                    setFilter(value);
                    if (selectedId) go("conversas");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="queue-list">
            {filtered.length ? (
              filtered.map((t) => (
                <a
                  href={`#/conversas?id=${t.id}`}
                  key={t.id}
                  className={`queue-row ${ticket?.id === t.id ? "selected" : ""} ${t.category === "urgencia" && activeTicket(t) ? "emergency-alert" : ""}`}
                >
                  <div className="queue-row-top">
                    {clinical ? <PetAvatar species={t.species} small /> : <UserRound aria-hidden="true" />}
                    <strong>{t.client_name || t.phone}</strong>
                    <time>{timeLabel(t.updated_at)}</time>
                  </div>
                  <p>{t.category === "urgencia" && activeTicket(t) ? "EMERGÊNCIA: " : ""}{t.subject}</p>
                  <div className="queue-row-bottom">
                    <Badge value={t.status} />
                    <span>
                      #{t.id}
                      {t.human_required && <UserRound />}
                    </span>
                  </div>
                </a>
              ))
            ) : (
              <Empty title="Nenhuma conversa encontrada" icon={MessageCircle} />
            )}
          </div>
        </section>
        <section className="conversation-detail">
          {ticket ? (
            <>
              <header className="conversation-heading">
                <button
                  className="icon-button mobile-back"
                  title="Voltar à lista"
                  onClick={() => go("conversas")}
                >
                  <ArrowLeft />
                </button>
                {clinical ? <PetAvatar species={ticket.species} /> : <UserRound aria-hidden="true" />}
                <div>
                  <h2>{ticket.client_name || ticket.phone}</h2>
                  <p>
                    {clinical ? `${ticket.pet_name || 'Pet não informado'} · ` : ''}{ticket.phone}
                  </p>
                </div>
                <Badge tone={ticket.human_required ? "violet" : "green"}>
                  {ticket.human_required ? <UserRound /> : <Bot />}
                  {ticket.human_required
                    ? "Equipe humana"
                    : "Assistente virtual"}
                </Badge>
              </header>
              <div className="ticket-actions">
                <button className="secondary-button" disabled={busy}
                  onClick={() => run(() => api.updateTicket(ticket.id, {
                    ai_paused: !(ticket.ai_paused || ticket.status === "em_atendimento"),
                    ...((ticket.ai_paused || ticket.status === "em_atendimento") ? { status: "novo" } : {}),
                  }), "Atendimento atualizado.")}>
                  {ticket.ai_paused || ticket.status === "em_atendimento" ? <Play /> : <Pause />}
                  {ticket.ai_paused || ticket.status === "em_atendimento" ? "Reativar IA" : "Pausar IA"}
                </button>
                <DeleteButton entity="tickets" id={ticket.id} label={`conversa #${ticket.id}`} warning="O histórico, as notificações e o checklist deste chamado serão excluídos." run={run} busy={busy} onDeleted={() => go("conversas")} />
              </div>
              <div className="ticket-controls">
                <Field label="Status">
                  <select
                    disabled={busy}
                    value={ticket.status}
                    onChange={(e) =>
                      run(
                        () =>
                          api.updateTicket(ticket.id, {
                            status: e.target.value,
                          }),
                        "Status atualizado.",
                      )
                    }
                  >
                    {[
                      "novo",
                      "em_atendimento",
                      "aguardando_cliente",
                      "resolvido",
                      "cancelado",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {statusLabels[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Prioridade">
                  <select
                    disabled={busy}
                    value={ticket.priority}
                    onChange={(e) =>
                      run(
                        () =>
                          api.updateTicket(ticket.id, {
                            priority: e.target.value,
                          }),
                        "Prioridade atualizada.",
                      )
                    }
                  >
                    <option value="alta">Alta</option>
                    <option value="normal">Normal</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </Field>
              </div>
              <div className="ai-summary">
                <Bot />
                <div>
                  <strong>Resumo do atendimento</strong>
                  <p>{ticket.ai_summary || "Ainda sem resumo."}</p>
                </div>
                <a
                  className="icon-button"
                  title={clinical ? 'Ver cadastro do paciente' : 'Ver cadastro do cliente'}
                  href={`#/pacientes?q=${encodeURIComponent(ticket.phone)}`}
                >
                  <PawPrint />
                </a>
              </div>
              <div className="message-list" ref={list}>
                {loadError ? (
                  <Empty title={loadError} />
                ) : loading && conversation?.ticket.id !== ticket.id ? (
                  <Empty title="Carregando conversa…" />
                ) : (
                  conversation?.ticket.id === ticket.id &&
                  conversation.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.direction}`}
                    >
                      <strong>{message.author}</strong>
                      <p><MessageText text={message.body} /></p>
                      <small>
                        {timeLabel(message.created_at)}{" "}
                        {message.direction === "outbound" && <Check />}
                      </small>
                    </article>
                  ))
                )}
              </div>
              {ticket.source === "simulador" && (
                <div className="conversation-note">Conversa de teste</div>
              )}
              <form className="chat-composer" onSubmit={send}>
                <textarea
                  rows={2}
                  placeholder="Responder como atendente…"
                  aria-label="Resposta ao cliente"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button
                  className="icon-button solid"
                  title="Enviar resposta"
                  disabled={busy || !reply.trim()}
                >
                  <Send />
                </button>
              </form>
            </>
          ) : (
            <Empty
              icon={MessageCircle}
              title={
                selectedId
                  ? "Conversa não encontrada"
                  : "Selecione uma conversa"
              }
            />
          )}
        </section>
      </div>
    </>
  );
}

export function AppointmentsPage({ dashboard: d, run, busy, route, go, clinical = true }) {
  const services = ['consulta','cirurgia','retorno','vacina','exame','banho_tosa'];
  const [date, setDate] = useState(route.params.get("data") || localDate());
  const [mode, setMode] = useState("dia");
  const [editing, setEditing] = useState(route.params.has("novo") ? {} : null);
  const [service, setService] = useState("");
  useEffect(() => {
    if (route.params.has("novo")) setEditing({});
    if (route.params.has("data")) setDate(route.params.get("data"));
  }, [route.params.toString()]);
  const appointments = (d.appointments || []).filter(
    (a) =>
      (mode === "todos" || a.scheduled_at.startsWith(date)) &&
      (!service || a.service === service),
  );
  function stepDate(offset) {
    const next = new Date(`${date}T12:00`);
    next.setDate(next.getDate() + offset);
    setDate(localDate(next));
  }
  function close() {
    setEditing(null);
    if (route.params.has("novo")) go("agendamentos");
  }
  return (
    <>
      <PageTitle
        title="Agendamentos"
        subtitle={clinical ? 'Agenda de consultas, procedimentos e cuidados.' : 'Agenda de serviços e compromissos.'}
      >
        <button className="primary-button" onClick={() => setEditing({})}>
          <Plus />
          Novo agendamento
        </button>
      </PageTitle>
      <div className="toolbar">
        <div className="date-toolbar">
          <button
            className="icon-button"
            title="Dia anterior"
            onClick={() => stepDate(-1)}
          >
            <ChevronLeft />
          </button>
          <input
            type="date"
            aria-label="Data da agenda"
            value={date}
            onChange={(e) => {
              if (e.target.value) setDate(e.target.value);
            }}
          />
          <button
            className="icon-button"
            title="Próximo dia"
            onClick={() => stepDate(1)}
          >
            <ChevronRight />
          </button>
          <button
            className="secondary-button"
            onClick={() => {
              setDate(localDate());
              setMode("dia");
            }}
          >
            Hoje
          </button>
        </div>
        <select
          aria-label="Filtrar serviço"
          value={service}
          onChange={(e) => setService(e.target.value)}
        >
          <option value="">Todos os serviços</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {serviceLabels[s]}
            </option>
          ))}
        </select>
        <div className="segmented">
          <button
            aria-pressed={mode === "dia"}
            className={mode === "dia" ? "selected" : ""}
            onClick={() => setMode("dia")}
          >
            Dia
          </button>
          <button
            aria-pressed={mode === "todos"}
            className={mode === "todos" ? "selected" : ""}
            onClick={() => setMode("todos")}
          >
            Todos
          </button>
        </div>
      </div>
      <div className="table-surface">
        {appointments.length ? (
          <table>
            <thead>
              <tr>
                <th>Data e horário</th>
                <th>{clinical ? 'Paciente / tutor' : 'Cliente'}</th>
                <th>Serviço</th>
                <th>Profissional</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{timeLabel(a.scheduled_at)}</strong>
                    <small>{dateLabel(a.scheduled_at)}</small>
                  </td>
                  <td>
                    <div className="cell-person">
                      {clinical && <PetAvatar species={a.species} small />}
                      <div>
                        <strong>{clinical ? a.pet_name || 'Pet sem nome' : a.client_name}</strong>
                        {clinical && <small>{a.client_name}</small>}
                      </div>
                    </div>
                  </td>
                  <td>{serviceLabels[a.service]}</td>
                  <td>{a.professional || "Não atribuído"}</td>
                  <td>
                    <Badge value={a.status} />
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      title={`Editar agendamento de ${a.pet_name || a.client_name}`}
                      onClick={() => setEditing(a)}
                    >
                      <Pencil />
                    </button>
                    <DeleteButton entity="appointments" id={a.id} label="agendamento" run={run} busy={busy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={CalendarDays}
            title="Nenhum agendamento neste período"
            action={
              <button className="primary-button" onClick={() => setEditing({})}>
                <Plus />
                Agendar atendimento
              </button>
            }
          />
        )}
      </div>
      {editing && (
        <AppointmentModal
          clinical={clinical}
          services={services}
          initial={editing}
          date={date}
          clients={d.clients}
          busy={busy}
          onClose={close}
          onSave={async (value) => {
            if (
              await run(
                () => api.saveAppointment(value, editing.id),
                "Agendamento salvo.",
              )
            )
              close();
          }}
        />
      )}
    </>
  );
}

function AppointmentModal({ initial, date, clients, onClose, onSave, busy, clinical = true, services = ['consulta','cirurgia','retorno','vacina','banho_tosa','exame'] }) {
  const [form, setForm] = useState({
    client_id: "",
    service: services[0],
    scheduled_at: `${date}T09:00`,
    professional: "",
    status: "aguardando",
    notes: "",
    ...initial,
  });
  const update = (key) => (e) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));
  return (
    <Modal
      title={initial.id ? "Editar agendamento" : "Novo agendamento"}
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <Field label={clinical ? 'Paciente' : 'Cliente'} wide>
          {clinical ? <ClientSelect
            clients={clients}
            value={form.client_id}
            onChange={update("client_id")}
          /> : <select value={form.client_id} onChange={update('client_id')} required><option value="">Selecione o cliente</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        </Field>
        {!clients.length && (
          <p className="form-hint wide">
            {clinical ? 'Cadastre um paciente na aba Pacientes antes de agendar.' : 'Cadastre um cliente na aba Clientes antes de agendar.'}
          </p>
        )}
        <Field label="Serviço">
          <select value={form.service} onChange={update("service")}>
            {[...new Set([...services,form.service])].map((s) => (
              <option key={s} value={s}>
                {serviceLabels[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Data e horário"
          required
          type="datetime-local"
          value={form.scheduled_at}
          onChange={update("scheduled_at")}
        />
        <Field label="Profissional">
          <input
            value={form.professional}
            onChange={update("professional")}
            placeholder="Nome do profissional"
          />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={update("status")}>
            {[
              "aguardando",
              "confirmado",
              "em_preparo",
              "concluido",
              "cancelado",
            ].map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observações" wide>
          <textarea rows={3} value={form.notes} onChange={update("notes")} />
        </Field>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

function FormActions({ busy, onClose }) {
  return (
    <div className="form-actions wide">
      <button type="button" className="secondary-button" onClick={onClose}>
        Cancelar
      </button>
      <button className="primary-button" disabled={busy}>
        <Save />
        {busy ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}

export function PatientsPage({ dashboard: d, route, run, busy }) {
  const [query, setQuery] = useState(route.params.get("q") || "");
  const [editing, setEditing] = useState(null);
  useEffect(
    () => setQuery(route.params.get("q") || ""),
    [route.params.get("q")],
  );
  const clients = d.clients.filter((c) =>
    matches(
      query,
      c.name,
      c.pet_name,
      c.phone,
      c.species,
      ...d.tickets.filter((t) => t.client_id === c.id).map((t) => `#${t.id}`),
    ),
  );
  return (
    <>
      <PageTitle
        title="Pacientes e tutores"
        subtitle={`${d.clients.length} cadastros na clínica`}
      >
        <button className="primary-button" onClick={() => setEditing({})}>
          <Plus />
          Novo paciente
        </button>
      </PageTitle>
      <div className="toolbar">
        <div className="input-search">
          <Search />
          <input
            placeholder="Buscar nome, tutor, telefone ou protocolo…"
            aria-label="Buscar pacientes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="result-count">
          {clients.length} {clients.length === 1 ? "cadastro" : "cadastros"}
        </span>
      </div>
      <div className="table-surface">
        {clients.length ? (
          <table>
            <thead>
              <tr>
                <th>Paciente</th>
                <th>Tutor</th>
                <th>WhatsApp</th>
                <th>Idade</th>
                <th>Atendimentos</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="cell-person">
                      <PetAvatar species={c.species} />
                      <div>
                        <strong>{c.pet_name || "Pet não informado"}</strong>
                        <small>
                          {[c.species, c.breed].filter(Boolean).join(" · ") ||
                            "Espécie não informada"}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{c.name}</strong>
                    <small>{c.email}</small>
                  </td>
                  <td>{c.phone}</td>
                  <td>{c.pet_age || "Não informada"}</td>
                  <td>
                    <Badge tone="neutral">{c.ticket_count} chamados</Badge>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      title={`Editar cadastro de ${c.name}`}
                      onClick={() => setEditing(c)}
                    >
                      <Pencil />
                    </button>
                    <DeleteButton entity="clients" id={c.id} label={`cadastro de ${c.name}`} warning="Serão excluídos tutor, pet, conversas, mensagens, agendamentos e acompanhamentos vinculados." run={run} busy={busy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty
            icon={PawPrint}
            title={
              query
                ? "Nenhum paciente encontrado"
                : "Cadastre o primeiro paciente"
            }
          />
        )}
      </div>
      {editing && (
        <ClientModal
          initial={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (form) => {
            if (
              await run(
                () =>
                  editing.id
                    ? api.updateClient(editing.id, form)
                    : api.saveClient(form),
                "Cadastro salvo.",
              )
            )
              setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ClientModal({ initial, busy, onSave, onClose }) {
  const [form, setForm] = useState(
    Object.fromEntries(
      [
        "name",
        "phone",
        "email",
        "pet_name",
        "species",
        "breed",
        "pet_age",
        "pet_weight",
        "notes",
      ].map((key) => [key, initial[key] || ""]),
    ),
  );
  const update = (key) => (e) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));
  return (
    <Modal
      title={initial.id ? "Cadastro do paciente" : "Novo paciente e tutor"}
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <div className="form-section-title wide">
          <UserRound />
          Tutor
        </div>
        <Field
          label="Nome do tutor"
          required
          value={form.name}
          onChange={update("name")}
        />
        <Field
          label="WhatsApp"
          required
          type="tel"
          pattern="[-+()0-9 .]{8,22}"
          placeholder="55 51 99999-9999"
          value={form.phone}
          onChange={update("phone")}
        />
        <Field
          label="E-mail"
          wide
          type="email"
          value={form.email}
          onChange={update("email")}
        />
        <div className="form-section-title wide">
          <PawPrint />
          Paciente
        </div>
        <Field
          label="Nome do pet"
          value={form.pet_name}
          onChange={update("pet_name")}
        />
        <Field label="Espécie">
          <input
            list="species-options"
            value={form.species}
            onChange={update("species")}
          />
          <datalist id="species-options">
            <option value="Cachorro" />
            <option value="Gato" />
            <option value="Coelho" />
            <option value="Ave" />
          </datalist>
        </Field>
        <Field label="Raça" value={form.breed} onChange={update("breed")} />
        <Field
          label="Idade"
          placeholder="Ex.: 3 anos"
          value={form.pet_age}
          onChange={update("pet_age")}
        />
        <Field
          label="Peso"
          placeholder="Ex.: 8 kg"
          value={form.pet_weight}
          onChange={update("pet_weight")}
        />
        <Field label="Observações" wide>
          <textarea rows={3} value={form.notes} onChange={update("notes")} />
        </Field>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

export function SurgeriesPage({ dashboard: d }) {
  const [filter, setFilter] = useState("abertas");
  const all = d.tickets.filter((t) => t.category === "cirurgia");
  const tickets = all.filter((t) => filter === "todas" || activeTicket(t));
  const upcoming = (d.appointments || []).filter(
    (a) =>
      a.service === "cirurgia" &&
      !["cancelado", "concluido"].includes(a.status),
  );
  return (
    <>
      <PageTitle
        title="Cirurgias"
        subtitle="Solicitações, preparação e retorno aos tutores."
      >
        <a href="#/agendamentos" className="secondary-button">
          <CalendarDays />
          Ver agenda
        </a>
        <a href="#/checklist" className="primary-button">
          <ClipboardCheck />
          Checklists
        </a>
      </PageTitle>
      <div className="metrics-grid three">
        <Metric
          icon={Scissors}
          value={all.filter(activeTicket).length}
          label="Solicitações abertas"
          detail="Acompanhamento da equipe"
          tone="rose"
          href="#/cirurgias"
        />
        <Metric
          icon={CalendarDays}
          value={upcoming.length}
          label="Procedimentos na agenda"
          detail="Aguardando realização"
          tone="green"
          href="#/agendamentos"
        />
        <Metric
          icon={CheckCheck}
          value={all.filter((t) => t.status === "resolvido").length}
          label="Atendimentos finalizados"
          detail="Solicitações concluídas"
          tone="violet"
          href="#/relatorios"
        />
      </div>
      <div className="toolbar">
        <h2>Solicitações de cirurgia</h2>
        <div className="segmented">
          {[
            ["abertas", "Em aberto"],
            ["todas", "Todas"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "selected" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="surgery-list">
        {tickets.length ? (
          tickets.map((t) => {
            const completed = (d.checklist || []).filter(
              (c) => c.ticket_id === t.id && c.checked,
            ).length;
            return (
              <article className="surgery-row" key={t.id}>
                <PetAvatar species={t.species} />
                <div className="surgery-info">
                  <div>
                    <strong>{t.pet_name || "Pet não informado"}</strong>
                    <Badge value={t.status} />
                  </div>
                  <span>
                    {t.client_name} · Protocolo #{t.id}
                  </span>
                  <p>{t.subject}</p>
                </div>
                <div className="surgery-progress">
                  <span>
                    Checklist <strong>{completed}/6</strong>
                  </span>
                  <progress value={completed} max={6} />
                </div>
                <a
                  href={`#/checklist?id=${t.id}`}
                  className="icon-button"
                  title="Abrir checklist"
                >
                  <ClipboardList />
                </a>
                <a href={`#/conversas?id=${t.id}`} className="secondary-button">
                  <MessageCircle />
                  Atendimento
                </a>
              </article>
            );
          })
        ) : (
          <Empty icon={Scissors} title="Nenhuma solicitação de cirurgia" />
        )}
      </div>
    </>
  );
}

export function ChecklistPage({ dashboard: d, busy, run, route, go }) {
  const surgeries = d.tickets.filter((t) => t.category === "cirurgia");
  const ticket =
    surgeries.find((t) => t.id === Number(route.params.get("id"))) ||
    surgeries[0];
  const completed = (d.checklist || []).filter(
    (c) => c.ticket_id === ticket?.id && c.checked,
  ).length;
  return (
    <>
      <PageTitle
        title="Checklist"
        subtitle="Acompanhamento das etapas de cada solicitação cirúrgica."
      />
      <div className="checklist-layout">
        <section className="checklist-patients">
          <h2>Solicitações de cirurgia</h2>
          {surgeries.length ? (
            surgeries.map((t) => (
              <a
                key={t.id}
                href={`#/checklist?id=${t.id}`}
                className={`checklist-patient ${ticket?.id === t.id ? "selected" : ""}`}
              >
                <PetAvatar species={t.species} small />
                <span>
                  <strong>{t.pet_name || "Pet não informado"}</strong>
                  <small>
                    {t.client_name} · #{t.id}
                  </small>
                </span>
                <ChevronRight />
              </a>
            ))
          ) : (
            <Empty title="Nenhuma solicitação recebida" />
          )}
        </section>
        <section className="checklist-detail">
          {ticket ? (
            <>
              <div className="checklist-heading">
                <div>
                  <span className="eyebrow">PROTOCOLO #{ticket.id}</span>
                  <h2>{ticket.pet_name || "Paciente não informado"}</h2>
                  <p>
                    {ticket.client_name} · {ticket.subject}
                  </p>
                </div>
                <Badge tone={completed === 6 ? "green" : "amber"}>
                  {completed === 6 ? "Completo" : "Em preparação"}
                </Badge>
              </div>
              <div className="checklist-progress">
                <span>{completed} de 6 etapas concluídas</span>
                <progress value={completed} max={6} />
              </div>
              <div className="checklist-items">
                {Object.entries(checklistLabels).map(([key, label], index) => {
                  const item = (d.checklist || []).find(
                    (c) => c.ticket_id === ticket.id && c.item_key === key,
                  );
                  return (
                    <label
                      key={key}
                      className={`checklist-item ${item?.checked ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={!!item?.checked}
                        disabled={busy}
                        onChange={(e) =>
                          run(() =>
                            api.setChecklist(ticket.id, {
                              key,
                              checked: e.target.checked,
                            }),
                          )
                        }
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>
                          {item?.updated_at
                            ? `Atualizado em ${dateLabel(item.updated_at)} às ${timeLabel(item.updated_at)}`
                            : `Etapa ${index + 1}`}
                        </small>
                      </span>
                      {item?.checked && <CheckCheck />}
                    </label>
                  );
                })}
              </div>
              <div className="checklist-footer">
                <a
                  href={`#/conversas?id=${ticket.id}`}
                  className="primary-button"
                >
                  <MessageCircle />
                  Abrir atendimento
                </a>
                <a href="#/cirurgias" className="text-button">
                  Ver cirurgias <ArrowRight />
                </a>
              </div>
            </>
          ) : (
            <Empty icon={ClipboardList} title="Nenhum checklist disponível" />
          )}
        </section>
      </div>
    </>
  );
}

export function NeonatalPage({ dashboard: d, run, busy }) {
  const [editing, setEditing] = useState(null);
  const [showDischarged, setShowDischarged] = useState(false);
  const care = (d.neonatal || []).filter(
    (n) => showDischarged || n.status !== "alta",
  );
  return (
    <>
      <PageTitle
        title="Neonatos"
        subtitle="Registros de acompanhamento dos pequenos pacientes."
      >
        <button className="primary-button" onClick={() => setEditing({})}>
          <Plus />
          Novo acompanhamento
        </button>
      </PageTitle>
      <div className="toolbar">
        <h2>
          {care.length} {care.length === 1 ? "paciente" : "pacientes"}
        </h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showDischarged}
            onChange={(e) => setShowDischarged(e.target.checked)}
          />
          Incluir pacientes com alta
        </label>
      </div>
      {care.length ? (
        <div className="patient-cards">
          {care.map((n) => (
            <article className="patient-card" key={n.id}>
              <header>
                <PetAvatar species={n.species} />
                <div>
                  <h2>{n.pet_name || "Pet sem nome"}</h2>
                  <span>
                    {n.species || "Espécie não informada"} ·{" "}
                    {n.pet_age || "Idade não informada"}
                  </span>
                </div>
                <button
                  className="icon-button"
                  title={`Atualizar acompanhamento de ${n.pet_name || n.client_name}`}
                  onClick={() => setEditing(n)}
                >
                  <Pencil />
                </button>
                <DeleteButton entity="neonatal" id={n.id} label="acompanhamento" run={run} busy={busy} />
              </header>
              <Badge value={n.status} />
              <dl>
                <div>
                  <dt>Tutor</dt>
                  <dd>{n.client_name}</dd>
                </div>
                <div>
                  <dt>Próxima verificação</dt>
                  <dd>
                    {n.next_check
                      ? `${dateLabel(n.next_check)} às ${timeLabel(n.next_check)}`
                      : "Não definida"}
                  </dd>
                </div>
              </dl>
              <p>{n.notes || "Sem observações registradas."}</p>
              <footer>
                <Clock3 />
                Atualizado em {dateLabel(n.updated_at)}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-surface">
          <Empty
            icon={Baby}
            title="Nenhum acompanhamento ativo"
            action={
              <button className="primary-button" onClick={() => setEditing({})}>
                <Plus />
                Adicionar paciente
              </button>
            }
          />
        </div>
      )}
      {editing && (
        <NeonatalModal
          initial={editing}
          clients={d.clients}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            if (
              await run(
                () => api.saveNeonatal(value, editing.id),
                "Acompanhamento salvo.",
              )
            )
              setEditing(null);
          }}
        />
      )}
    </>
  );
}

function NeonatalModal({ initial, clients, busy, onClose, onSave }) {
  const [form, setForm] = useState({
    client_id: "",
    status: "observacao",
    next_check: "",
    notes: "",
    ...initial,
  });
  const update = (key) => (e) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));
  return (
    <Modal
      title={initial.id ? "Atualizar acompanhamento" : "Novo acompanhamento"}
      onClose={onClose}
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <Field label="Paciente" wide>
          <ClientSelect
            clients={clients}
            value={form.client_id}
            onChange={update("client_id")}
          />
        </Field>
        <Field label="Condição registrada">
          <select value={form.status} onChange={update("status")}>
            {["observacao", "estavel", "alta"].map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Próxima verificação"
          type="datetime-local"
          value={form.next_check}
          onChange={update("next_check")}
        />
        <Field label="Observações da equipe" wide>
          <textarea rows={5} value={form.notes} onChange={update("notes")} />
        </Field>
        <FormActions busy={busy} onClose={onClose} />
      </form>
    </Modal>
  );
}

export function ReportsPage({ dashboard: d, clinical = true }) {
  const [period, setPeriod] = useState("30");
  const start = new Date();
  start.setDate(start.getDate() - Number(period));
  start.setHours(0, 0, 0, 0);
  const tickets = d.tickets.filter(
    (t) => period === "todos" || new Date(t.created_at) >= start,
  );
  const total = tickets.length;
  const resolved = tickets.filter((t) => t.status === "resolvido").length;
  const categories = Object.entries(serviceLabels)
    .map(([value, label]) => ({
      label,
      count: tickets.filter((t) => t.category === value).length,
    }))
    .filter((c) => c.count);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i);
    return {
      label: date.toLocaleDateString("pt-BR", { weekday: "short" }),
      date: localDate(date),
      count: d.tickets.filter(
        (t) => localDate(new Date(t.created_at)) === localDate(date),
      ).length,
    };
  });
  const max = Math.max(1, ...days.map((day) => day.count));
  function exportCsv() {
    const rows = [
      [
        "Protocolo",
        clinical ? 'Tutor' : 'Cliente',
        clinical ? 'Paciente' : 'Contato',
        "Categoria",
        "Status",
        "Responsavel",
        "Criado em",
      ],
      ...tickets.map((t) => [
        t.id,
        t.client_name,
        clinical ? t.pet_name : t.phone,
        serviceLabels[t.category] || t.category,
        statusLabels[t.status],
        t.assigned_to,
        t.created_at,
      ]),
    ];
    const escape = (value) => {
      let text = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const url = URL.createObjectURL(
      new Blob(
        ["\ufeff" + rows.map((row) => row.map(escape).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8;" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `acores-atendimentos-${localDate()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <PageTitle
        title="Relatórios"
        subtitle="Indicadores da central de atendimento."
      >
        <select
          aria-label="Período do relatório"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="todos">Todo o período</option>
        </select>
        <button className="secondary-button" onClick={exportCsv}>
          <ArrowDownToLine />
          Exportar CSV
        </button>
      </PageTitle>
      <div className="metrics-grid">
        <Metric
          icon={MessageCircle}
          value={total}
          label="Atendimentos"
          detail="No período selecionado"
          tone="violet"
          href="#/conversas"
        />
        <Metric
          icon={CheckCheck}
          value={resolved}
          label="Finalizados"
          detail={`${total ? Math.round((resolved / total) * 100) : 0}% dos atendimentos`}
          tone="green"
          href="#/conversas"
        />
        <Metric
          icon={Users}
          value={tickets.filter((t) => t.human_required).length}
          label="Encaminhados à equipe"
          detail="Atendimento humano"
          tone="rose"
          href="#/conversas"
        />
        <Metric
          icon={PawPrint}
          value={new Set(tickets.map((t) => t.client_id).filter(Boolean)).size}
          label={clinical ? 'Tutores atendidos' : 'Clientes atendidos'}
          detail="Com chamado no período"
          tone="amber"
          href="#/pacientes"
        />
      </div>
      <div className="reports-grid">
        <Section title="Novos chamados · últimos 7 dias">
          <div
            className="bar-chart"
            role="img"
            aria-label={days
              .map((day) => `${day.label}: ${day.count} chamados`)
              .join("; ")}
          >
            {days.map((day) => (
              <div className="bar-column" key={day.date}>
                <strong>{day.count}</strong>
                <div className="bar-track">
                  <div
                    className="chart-bar"
                    style={{ height: `${(day.count / max) * 100}%` }}
                  />
                </div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Atendimentos por serviço">
          {categories.length ? (
            <div className="category-bars">
              {categories.map((category, i) => (
                <div
                  className={`category-bar color-${i % 4}`}
                  key={category.label}
                >
                  <div>
                    <strong>{category.label}</strong>
                    <span>{category.count}</span>
                  </div>
                  <progress value={category.count} max={total || 1} />
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Sem atendimentos no período" />
          )}
        </Section>
      </div>
      <Section title="Situação dos atendimentos">
        <div className="status-report">
          {[
            "novo",
            "em_atendimento",
            "aguardando_cliente",
            "resolvido",
            "cancelado",
          ].map((s) => (
            <div key={s}>
              <Badge value={s} />
              <strong>{tickets.filter((t) => t.status === s).length}</strong>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

export function SettingsPage(props) {
  const { dashboard: d, run, busy, clinical = true } = props;
  const [form, setForm] = useState({
    name: "",
    unit: "",
    phone: "",
    address: "",
    ...d.settings,
  });
  const update = (key) => (e) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));
  const status = d.whatsapp || {};
  return (
    <>
      <PageTitle
        title="Configurações"
        subtitle={clinical ? 'Dados da clínica e conexão com o WhatsApp.' : 'Dados da empresa e conexão com o WhatsApp.'}
      />
      <div className="settings-layout">
        <section className="settings-form">
          <div className="section-heading">
            <h2>
              <Stethoscope />
              {clinical ? 'Dados da clínica' : 'Dados da empresa'}
            </h2>
          </div>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api.saveSettings(form), "Configurações salvas.");
            }}
          >
            <Field
              label={clinical ? 'Nome da clínica' : 'Nome da empresa'}
              wide
              required
              value={form.name}
              onChange={update("name")}
            />
            <Field
              label="Unidade"
              required
              value={form.unit}
              onChange={update("unit")}
            />
            <Field
              label="Telefone"
              type="tel"
              value={form.phone}
              onChange={update("phone")}
            />
            <Field
              label="Endereço"
              wide
              value={form.address}
              onChange={update("address")}
            />
            <div className="form-actions wide">
              <button disabled={busy} className="primary-button">
                <Save />
                Salvar alterações
              </button>
            </div>
          </form>
        </section>
        <section className="whatsapp-settings">
          <div className="section-heading">
            <h2>
              <Phone />
              WhatsApp da empresa
            </h2>
            <Badge tone={status.connected ? "green" : "amber"}>
              {status.connected
                ? "Conectado"
                : status.mode === "qr"
                  ? "Aguardando leitura"
                  : "Desconectado"}
            </Badge>
          </div>
          <div className="qr-area">
            {status.qrDataUrl ? (
              <img
                src={status.qrDataUrl}
                alt="QR Code para conectar o WhatsApp da empresa"
              />
            ) : status.connected ? (
              <ShieldCheck className="connection-illustration connected" />
            ) : (
              <QrCode className="connection-illustration" />
            )}
          </div>
          <p className="connection-event">
            {status.lastEvent || "Nenhum aparelho conectado."}
          </p>
          <button
            type="button"
            disabled={
              busy ||
              status.connected ||
              ["connecting", "starting"].includes(status.mode)
            }
            className="primary-button"
            onClick={() =>
              run(
                () => status.requiresNewQr ? api.relinkWhatsApp() : api.startWhatsApp(),
                (result) => result?.qrDataUrl ? "QR Code pronto. Escaneie pelo WhatsApp." : "Conexão solicitada. Aguarde o QR Code.",
              )
            }
          >
            <QrCode />
            {status.requiresNewQr
              ? "Gerar novo QR Code"
              : status.connected
              ? "WhatsApp conectado"
              : status.mode === "qr"
                ? "Atualizar conexão"
                : "Conectar WhatsApp"}
          </button>
          {status.connected && (
            <button
              type="button"
              className="secondary-button archive-sync-button"
              disabled={busy}
              onClick={() =>
                run(
                  () => api.syncWhatsApp(),
                  (result) =>
                    result.archiveSyncReady
                      ? "Conversas sincronizadas."
                      : "Respostas pausadas. A sincronização ainda não foi confirmada.",
                )
              }
            >
              <ShieldCheck />
              Sincronizar conversas
            </button>
          )}
        </section>
      </div>
      <AISettings key={d.ai ? "configured" : "loading"} {...props} />
    </>
  );
}

export function NotificationsPage({ dashboard: d, busy, run }) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = d.notifications.filter(
    (n) => !unreadOnly || !n.read_at,
  );
  return (
    <>
      <PageTitle
        title="Notificações"
        subtitle={`${d.stats.unreadNotifications} notificações não lidas`}
      >
        <button
          className="secondary-button"
          disabled={busy || !d.stats.unreadNotifications}
          onClick={() =>
            run(
              () => api.markNotificationsRead(),
              "Notificações marcadas como lidas.",
            )
          }
        >
          <CheckCheck />
          Marcar todas como lidas
        </button>
      </PageTitle>
      <div className="toolbar">
        <h2>Atividade da central</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Somente não lidas
        </label>
      </div>
      <div className="notifications-full">
        {notifications.length ? (
          notifications.map((n) => (
            <article
              key={n.id}
              className={`notification-row ${n.read_at ? "read" : ""}`}
            >
              <span
                className={`notification-symbol ${n.level === "warning" ? "rose" : "violet"}`}
              >
                {n.level === "warning" ? <AlertTriangle /> : <Bell />}
              </span>
              <div>
                <strong>
                  {n.title}
                  {!n.read_at && (
                    <span className="unread-dot" aria-label="Não lida" />
                  )}
                </strong>
                <p>{n.body}</p>
                <small>
                  {dateLabel(n.created_at)} às {timeLabel(n.created_at)}
                </small>
              </div>
              {n.ticket_id && (
                <a
                  className="secondary-button"
                  href={`#/conversas?id=${n.ticket_id}`}
                >
                  Ver chamado
                  <ArrowRight />
                </a>
              )}
              <DeleteButton entity="notifications" id={n.id} label="notificação" run={run} busy={busy} />
            </article>
          ))
        ) : (
          <Empty icon={Bell} title="Nenhuma notificação por aqui" />
        )}
      </div>
    </>
  );
}
