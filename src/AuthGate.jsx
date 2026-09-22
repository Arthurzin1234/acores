import { useEffect, useId, useState } from 'react';
import { Check, Eye, EyeOff, LogOut, LockKeyhole, Mail } from 'lucide-react';
import { api, setCSRF } from './api.js';
import { Modal } from './ui.jsx';
import { OperationsPage } from './OperationsPage.jsx';
import Markdown from 'react-markdown';
import { Identity } from './identity.js';

function AuthFrame({ children }) {
  return <main className="auth-screen acores-auth">
    <section className="auth-form clinic-form">
      <a className="clinic-brand" href="#/login" aria-label="Açores, entrar">
        <img src="/assets/acores-logo-oficial.jpg" alt="Centro Veterinário dos Açores" width="140" height="140" />
        <span>Central de atendimento veterinário</span>
      </a>{children}
    </section>
  </main>;
}
function AuthField({ label, icon: Icon, password = false, ...props }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return <div className="auth-field"><label htmlFor={id}>{label}</label><span className="auth-input">
    <Icon aria-hidden="true" /><input {...props} id={id} type={password ? visible ? 'text' : 'password' : props.type || 'text'} />
    {password && <button type="button" className="auth-reveal" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} title={visible ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</button>}
  </span></div>;
}
function LegalConsent({ legal, agreed, setAgreed, open }) {
  return <div className="auth-legal"><div className="legal-links">
    <button type="button" className="text-button" disabled={!legal} onClick={() => open('terms')}>Termos de Uso</button>
    <button type="button" className="text-button" disabled={!legal} onClick={() => open('privacy')}>Política de Privacidade</button>
  </div>
    <label className="legal-checkbox"><input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
      <span>Aceito os Termos de Uso e declaro ciência da Política de Privacidade.</span>
    </label>
  </div>;
}
function PasswordForm({ busy, error, onSave }) {
  return <form className="auth-fields" onSubmit={(event) => { event.preventDefault(); onSave(Object.fromEntries(new FormData(event.currentTarget))); }}>
    <AuthField label="Senha atual" icon={LockKeyhole} password name="currentPassword" required autoComplete="current-password" />
    <AuthField label="Nova senha" icon={LockKeyhole} password name="password" required minLength={10} maxLength={72} autoComplete="new-password" placeholder="No mínimo 10 caracteres" />
    <AuthField label="Confirme a nova senha" icon={LockKeyhole} password name="confirmation" required minLength={10} maxLength={72} autoComplete="new-password" />
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="primary-button auth-submit" disabled={busy}><Check />{busy ? 'Salvando...' : 'Salvar nova senha'}</button>
  </form>;
}
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false), [legal, setLegal] = useState(null), [agreed, setAgreed] = useState(false);
  const [document, setDocument] = useState(null);
  const accept = (data) => { setCSRF(data.csrf); setSession(data); if (data.user) setAgreed(false); };
  useEffect(() => {
    window.document.title = 'Açores | Central de Atendimento';
  }, []);
  useEffect(() => {
    let mounted = true;
    api.legal().then((data) => { if (mounted) setLegal(data); }).catch(() => { if (mounted) setError('Não foi possível carregar os documentos. Recarregue a página.'); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    let mounted = true;
    const load = () => api.session().then((s) => { if (mounted) accept(s); }).catch(() => { if (mounted) setError('Não foi possível conectar. Recarregue a página.'); });
    load();
    const expired = () => { accept({ user: null }); setError('Sua sessão expirou. Entre novamente.'); };
    window.addEventListener('session-expired', expired);
    const timer = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('session-expired', expired); };
  }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    if (!agreed || !legal) { setError('Confira e confirme os documentos para continuar.'); setBusy(false); return; }
    const data = Object.fromEntries(new FormData(event.currentTarget));
    Object.assign(data, { acceptedTerms: true, privacyAcknowledged: true, legalVersion: legal.version });
    try {
      accept(await (session.setupRequired ? api.setup(data) : api.login(data))); window.location.hash = '/inicio';
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function changePassword(data) {
    setError('');
    if (data.password !== data.confirmation) { setError('As senhas não conferem.'); return; }
    setBusy(true);
    try { accept(await api.changePassword({ currentPassword: data.currentPassword, password: data.password })); setChanging(false); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function logout() {
    try { await api.logout(); accept({ user: null }); setError(''); window.location.hash = '/login'; }
    catch { setError('Não foi possível sair.'); }
  }
  async function reconnect() {
    setBusy(true); setError('');
    try { setLegal(await api.legal()); accept(await api.session()); }
    catch { setError('Não foi possível conectar ao servidor. Tente novamente em instantes.'); }
    finally { setBusy(false); }
  }
  if (!session?.user) return <AuthFrame>
    <h1>{session?.setupRequired ? 'Criar administrador' : 'Entrar nos Açores'}</h1>
    <form className="auth-fields" onSubmit={submit}>
      {session?.setupRequired && <AuthField label="Código de instalação" icon={LockKeyhole} name="token" required autoComplete="off" password />}
      <AuthField label={session?.setupRequired ? 'E-mail' : 'E-mail ou usuário'} icon={Mail} name="email" type={session?.setupRequired ? 'email' : 'text'} autoComplete="username" required maxLength={254} autoCapitalize="none" spellCheck={false} />
      <AuthField label="Senha" icon={LockKeyhole} name="password" password autoComplete={session?.setupRequired ? 'new-password' : 'current-password'} required minLength={session?.setupRequired ? 10 : 1} maxLength={72} />
      <LegalConsent legal={legal} agreed={agreed} setAgreed={setAgreed} open={setDocument} />
      {error && <p className="auth-error" role="alert">{error}</p>}
      {(!session || !legal) && error && <button className="secondary-button" type="button" onClick={reconnect} disabled={busy}>Tentar conectar novamente</button>}
      <button className="primary-button auth-submit" disabled={busy || !session || !legal}><LockKeyhole />{busy ? 'Aguarde...' : session?.setupRequired ? 'Criar conta' : 'Entrar'}</button>
      <p className="auth-help">Esqueceu sua senha? Solicite a redefinição ao administrador dos Açores.</p>
    </form>
    {document && legal && <Modal title={legal[document].title} onClose={() => setDocument(null)}>
      <article className="legal-document"><Markdown components={{ a: ({ node, children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{legal[document].content}</Markdown></article>
    </Modal>}
  </AuthFrame>;
  return <Identity.Provider value={session.user}>
    <div className="account-bar"><span>{session.user.company?.name} · {session.user.username || session.user.email}</span>
      <button className="text-button" onClick={() => { setChanging(true); setError(''); }}><LockKeyhole />Alterar senha</button>
      <button className="text-button" onClick={logout}><LogOut />Sair</button>
    </div>
    {changing && <Modal title="Alterar senha" onClose={() => setChanging(false)}><PasswordForm busy={busy} error={error} onSave={changePassword} /></Modal>}
    {['administrador','atendente'].includes(session.user.role) ? children : <RestrictedView user={session.user} />}
  </Identity.Provider>;
}
function RestrictedView({ user }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api.dashboard().then(setData).catch((e) => setError(e.message)); }, []);
  async function run(action) { setBusy(true); try { const result = await action(); setData(await api.dashboard()); setError(''); return result; } catch (e) { setError(e.message); return false; } finally { setBusy(false); } }
  return <main className="restricted-view">{error && <p role="alert">{error}</p>}
    {user.role === 'tecnico' ? data && <OperationsPage dashboard={data} run={run} busy={busy} /> : <>
      <h1>Meus registros</h1>
      {data?.clients.map((c) => <section key={c.id}><h2>{c.pet_name || 'Paciente'}</h2><p>{c.name} · {c.species} · {c.pet_age}</p></section>)}
      {data?.tickets.map((t) => <section key={t.id}><h2>#{t.id} {t.subject}</h2><p>{t.status}</p></section>)}
      {data && !data.clients.length && <p>Nenhum cadastro vinculado à sua conta.</p>}
    </>}
  </main>;
}
