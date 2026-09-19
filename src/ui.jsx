import { useEffect, useRef } from "react";
import { Cat, Dog, PawPrint, X, Inbox } from "lucide-react";

export const statusLabels = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando retorno",
  resolvido: "Finalizado",
  cancelado: "Cancelado",
  aguardando: "Aguardando",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  concluido: "Concluído",
  estavel: "Estável",
  observacao: "Em observação",
  alta: "Alta",
};
export const serviceLabels = {
  procedimento: 'Procedimento', avaliacao: 'Avaliação',
  servico: 'Serviço', reuniao: 'Reunião', visita: 'Visita', reserva: 'Reserva',
  cirurgia: "Cirurgia",
  urgencia: "Urgência",
  banho_tosa: "Banho e tosa",
  consulta: "Consulta",
  orcamento: "Orçamento",
  geral: "Geral",
  retorno: "Retorno",
  vacina: "Vacina",
  exame: "Exame",
};
export const checklistLabels = {
  tutor: "Contato do tutor confirmado",
  dados: "Dados do paciente completos",
  exames: "Exames recebidos",
  avaliacao: "Avaliação veterinária registrada",
  autorizacao: "Autorização do tutor recebida",
  retorno: "Retorno combinado com o tutor",
};
export const activeTicket = (t) =>
  !["resolvido", "cancelado"].includes(t.status);
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const timeLabel = (value) =>
  value
    ? new Date(value).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      })
    : "Sem data";
export const matches = (query, ...values) =>
  values
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(
      query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase(),
    );

export function Badge({ value, children, tone = "" }) {
  return (
    <span className={`badge ${tone || `status-${value}`}`}>
      {children || statusLabels[value] || value}
    </span>
  );
}
export function PetAvatar({ species = "", name = "", small = false }) {
  const cat = /gato|felin/i.test(species);
  const Icon = cat
    ? Cat
    : /cachorro|cão|cao|canin/i.test(species)
      ? Dog
      : PawPrint;
  return (
    <span
      className={`pet-avatar ${cat ? "cat" : "dog"} ${small ? "small" : ""}`}
      aria-label={name || species || "Pet"}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}
export function Empty({
  icon: Icon = Inbox,
  title = "Nenhum registro por aqui",
  children,
  action,
}) {
  return (
    <div className="empty-state">
      <Icon aria-hidden="true" />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function Section({
  title,
  icon: Icon,
  link,
  children,
  className = "",
  badge,
}) {
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <h2>
          {Icon && <Icon aria-hidden="true" />}
          {title}
          {badge > 0 && <span className="count-badge">{badge}</span>}
        </h2>
        {link && (
          <a href={link.href}>
            {link.label || "Ver todos"}
            <span aria-hidden="true"> ↗</span>
          </a>
        )}
      </div>
      {children}
    </section>
  );
}
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            type="button"
            title="Fechar"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Field({ label, children, wide = false, ...props }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children || <input {...props} />}
    </label>
  );
}
export function PageTitle({ title, subtitle, children }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
export function Metric({ icon: Icon, value, label, detail, tone, href }) {
  return (
    <a className={`metric metric-${tone}`} href={href}>
      <span className="metric-icon">
        <Icon aria-hidden="true" />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </a>
  );
}
export function ClientSelect({ clients, value, onChange }) {
  return (
    <select required value={value || ""} onChange={onChange}>
      <option value="">Selecione um paciente</option>
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.pet_name || "Pet sem nome"} · {client.name}
        </option>
      ))}
    </select>
  );
}
