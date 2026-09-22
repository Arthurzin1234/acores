import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Identity } from './identity.js';
import {
  Activity,
  Baby,
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardList,
  Heart,
  House,
  Menu,
  MessageCircle,
  PawPrint,
  RefreshCw,
  Scissors,
  Search,
  Settings,
  X,
  Workflow,
} from "lucide-react";
import { api } from "./api.js";
import {
  HomePage,
  ConversationsPage,
  AppointmentsPage,
  SurgeriesPage,
  PatientsPage,
  ChecklistPage,
  NeonatalPage,
  ReportsPage,
  SettingsPage,
  NotificationsPage,
} from "./pages.jsx";
import { activeTicket } from "./ui.jsx";
import FlowBuilder from './FlowBuilder.jsx';

const navigation = [
  ["inicio", "Início", House],
  ["conversas", "Conversas", MessageCircle],
  ["agendamentos", "Agendamentos", CalendarDays],
  ["cirurgias", "Cirurgias", Scissors],
  ["pacientes", "Pacientes", PawPrint],
  ["checklist", "Checklist", ClipboardList],
  ["neonatos", "Neonatos", Baby],
  ["relatorios", "Relatórios", ChartNoAxesCombined],
  ["configuracoes", "Configurações", Settings],
  ["fluxos", "Fluxos", Workflow],
];
function readRoute() {
  const [path, params] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { page: path || "inicio", params: new URLSearchParams(params) };
}
export default function App() {
  const identity = useContext(Identity);
  const [dashboard, setDashboard] = useState(null);
  const [route, setRoute] = useState(readRoute);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(false);
  const actionLock = useRef(false);
  const noticeTimer = useRef(null);
  const refresh = useCallback(async () => {
    const payload = await api.dashboard();
    setDashboard(payload);
    setError("");
    return payload;
  }, []);
  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    const onHash = () => {
      setRoute(readRoute());
      setMenuOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      clearTimeout(noticeTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    let socket;
    let retry;
    let fallbackPoll;
    let stopped = false;
    const scheduleFallback = () => {
      clearInterval(fallbackPoll);
      fallbackPoll = setInterval(() => {
        if (!stopped) refresh().catch((err) => setError(err.message));
      }, 15000);
    };
    function connect() {
      const origin = new URL(
        import.meta.env.VITE_WS_URL || import.meta.env.VITE_API_URL || window.location.origin,
      );
      const channel = '/ws';
      socket = new WebSocket(
        `${origin.protocol === "https:" ? "wss:" : "ws:"}//${origin.host}${channel}`,
      );
      socket.onopen = () => {
        clearInterval(fallbackPoll);
        setLive(true);
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "dashboard") {
          setDashboard(data.payload);
          setError("");
        }
        if (data.type === "whatsapp_status")
          setDashboard((current) =>
            current ? { ...current, whatsapp: data.payload } : current,
          );
      };
      socket.onclose = () => {
        setLive(false);
        scheduleFallback();
        if (!stopped) retry = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(fallbackPoll);
      socket?.close();
    };
  }, [refresh]);
  const notify = useCallback((message, type = "success") => {
    setNotice({ message, type });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  async function run(action, message) {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    try {
      const result = await action();
      try {
        let payload = await refresh();
        if (['starting', 'reconnecting', 'qr'].includes(result?.mode)) {
          for (let attempt = 0; attempt < 15 && !payload?.whatsapp?.qrDataUrl && !payload?.whatsapp?.connected; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            payload = await refresh();
          }
        }
      } catch {
        notify(
          "Registro salvo. Atualize o painel para carregar os dados.",
          "error",
        );
      }
      if (message)
        notify(typeof message === "function" ? message(result) : message);
      return result ?? true;
    } catch (err) {
      notify(err.message, "error");
      return false;
    } finally {
      setBusy(false);
      actionLock.current = false;
    }
  }
  function go(page, params = "") {
    window.location.hash = `/${page}${params ? `?${params}` : ""}`;
  }
  if (!dashboard)
    return (
      <main className="loading-screen">
        <PawPrint />
        <h1>{'Centro Veterinário dos Açores'}</h1>
        <p>{error || "Carregando sua central de atendimento…"}</p>
        {error && (
          <button
            className="primary-button"
            onClick={() => refresh().catch((err) => setError(err.message))}
          >
            <RefreshCw />
            Tentar novamente
          </button>
        )}
      </main>
    );
  const openTickets = dashboard.tickets.filter(activeTicket);
  const props = { dashboard, run, busy, go, notify, route };
  const pages = {
    inicio: HomePage,
    conversas: ConversationsPage,
    agendamentos: AppointmentsPage,
    cirurgias: SurgeriesPage,
    pacientes: PatientsPage,
    checklist: ChecklistPage,
    neonatos: NeonatalPage,
    relatorios: ReportsPage,
    configuracoes: SettingsPage,
    notificacoes: NotificationsPage,
    fluxos: FlowBuilder,
  };
  const allowedPage = (id) => (id !== 'configuracoes' || identity.role === 'administrador');
  const Page = allowedPage(route.page) ? pages[route.page] : null;
  const unit = dashboard.settings?.unit || "Matriz";
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      {menuOpen && (
        <button
          className="nav-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <a href="#/inicio" className="brand" aria-label={`${dashboard.company?.name || 'Açores'}, início`}>
          <PawPrint className="brand-paw" />
          <span>Centro Veterinário dos</span>
          <strong>Açores</strong>
          <small>SAÚDE · CUIDADO · BEM-ESTAR</small>
        </a>
        <span className="nav-caption">CENTRAL DE ATENDIMENTO</span>
        <nav aria-label="Menu principal">
          {navigation.filter(([id]) => allowedPage(id)).map(([id, label, Icon]) => (
            <a
              key={id}
              href={`#/${id}`}
              className={`nav-item ${route.page === id ? "active" : ""}`}
              aria-current={route.page === id ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {id === "conversas" && openTickets.length > 0 && (
                <span className="nav-count">{openTickets.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <PawPrint />
          <p>
            <>Cuidando de<br />quem você ama <Heart /></>
          </p>
          <a href="#/configuracoes" className="sidebar-connection">
            <span
              className={`status-dot ${dashboard.whatsapp?.connected ? "green" : "amber"}`}
            />
            WhatsApp{" "}
            {dashboard.whatsapp?.connected ? "conectado" : "desconectado"}
            <ChevronDown />
          </a>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            title="Abrir menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </button>
          <form
            className="global-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              go("pacientes", `q=${encodeURIComponent(search)}`);
            }}
          >
            <Search aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar cliente, pet ou protocolo"
              placeholder="Buscar por cliente, pet ou protocolo..."
            />
            {search && (
              <button type="submit" className="icon-button" title="Buscar">
                <ChevronDown className="search-arrow" />
              </button>
            )}
          </form>
          <div className="topbar-right">
            <a
              className={`icon-button notification-button ${route.page === "notificacoes" ? "current" : ""}`}
              href="#/notificacoes"
              title="Notificações"
              aria-label={`Notificações, ${dashboard.stats.unreadNotifications} não lidas`}
            >
              <Bell />
              {dashboard.stats.unreadNotifications > 0 && (
                <span>{dashboard.stats.unreadNotifications}</span>
              )}
            </a>
            <a className="clinic-profile" href="#/configuracoes">
              <span className="profile-avatar">
                {unit
                  .split(" ")
                  .map((word) => word[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span>
                <strong>{unit}</strong>
                <small>
                  <span className={`status-dot ${live ? "green" : "amber"}`} />
                  {live ? "Painel conectado" : "Reconectando"}
                </small>
              </span>
              <ChevronDown />
            </a>
          </div>
        </header>
        {dashboard.tickets.filter((t) => t.category === "urgencia" && !["resolvido", "cancelado"].includes(t.status)).length > 0 && (
          <a className="emergency-alert emergency-banner" role="alert"
            href={`#/conversas?id=${dashboard.tickets.find((t) => t.category === "urgencia" && !["resolvido", "cancelado"].includes(t.status)).id}`}>
            Emergência: atendimento prioritário pendente. Abrir conversa
          </a>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className={`page-content page-${route.page}`}
        >
          {Page ? (
            <Page key={route.page} {...props} />
          ) : (
            <div className="empty-state">
              <h1>Página não encontrada</h1>
              <a href="#/inicio" className="primary-button">
                Voltar ao início
              </a>
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>
            {dashboard.settings?.name} © {new Date().getFullYear()}
          </span>
          <span>
            <Activity /> Central de Atendimento Inteligente
          </span>
          <span>
            <Heart /> Feito para cuidar
          </span>
        </footer>
      </div>
      {notice && (
        <div
          className={`toast ${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          <button
            className="icon-button"
            title="Fechar aviso"
            onClick={() => setNotice(null)}
          >
            <X />
          </button>
        </div>
      )}
    </div>
  );
}
