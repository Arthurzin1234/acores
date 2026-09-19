import { useEffect, useState } from 'react';
import { Check, KeyRound, Pause, Play, Plus, ShieldCheck, Users } from 'lucide-react';
import { api } from './api.js';
import { Badge, Empty, Field, Modal, PageTitle } from './ui.jsx';

export function UsersPage({run,busy}) {
  const [rows,setRows] = useState([]), [error,setError] = useState(''), [modal,setModal] = useState(null);
  const load = () => api.users().then((r) => {setRows(r);setError('');}).catch((e) => setError(e.message));
  useEffect(() => {load();},[]);
  const roles = [['administrador','Administrador da central'],['atendente','Atendente'],['tecnico','Técnico']];
  async function save(data,id) { if (await run(() => api.saveUser(data,id),'Acesso atualizado.')) {setModal(null); await load();} }
  return <><PageTitle title="Acessos e permissões" subtitle="Usuários dos Açores"><button className="primary-button" disabled={busy} onClick={() => setModal({type:'new'})}><Plus />Novo acesso</button></PageTitle>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="table-surface"><table className="access-table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{rows.map((u) => <tr key={u.id}><td><strong>{u.username || u.email}</strong><small>{u.email}</small></td><td>{roles.find(([id]) => id === u.role)?.[1] || u.role}</td><td><Badge tone={u.active ? 'green' : 'gray'}>{u.active ? u.must_change_password ? 'Senha provisória' : 'Ativo' : 'Suspenso'}</Badge></td><td><div className="access-row-actions">
      <button className="icon-button" disabled={busy} title="Alterar perfil" aria-label={`Alterar perfil de ${u.username || u.email}`} onClick={() => setModal({type:'role',user:u})}><ShieldCheck /></button>
      <button className="icon-button" disabled={busy} title="Redefinir senha" aria-label={`Redefinir senha de ${u.username || u.email}`} onClick={() => setModal({type:'password',user:u})}><KeyRound /></button>
      <button className="icon-button" disabled={busy} title={u.active ? 'Suspender acesso' : 'Reativar acesso'} aria-label={`${u.active ? 'Suspender' : 'Reativar'} ${u.username || u.email}`} onClick={() => setModal({type:'active',user:u})}>{u.active ? <Pause /> : <Play />}</button>
    </div></td></tr>)}</tbody></table>{!rows.length && <Empty icon={Users} title="Nenhum acesso encontrado" />}</div>
    {modal && <Modal title={modal.type === 'new' ? 'Novo acesso' : modal.type === 'active' ? `${modal.user.active ? 'Suspender' : 'Reativar'} acesso?` : modal.type === 'role' ? 'Alterar perfil de acesso' : 'Redefinir senha'} onClose={() => setModal(null)}>
      <form className="form-grid" onSubmit={(e) => {e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); save(modal.type === 'new' ? data : {...data,confirmed:true,...(modal.type === 'active' ? {active:!modal.user.active} : {})},modal.user?.id);}}>
        {modal.type === 'new' && <><Field label="E-mail" name="email" type="email" required maxLength={254} wide /><Field label="Usuário" name="username" required minLength={3} maxLength={80} pattern="[a-zA-Z0-9._\-]+" wide /></>}
        {['new','role'].includes(modal.type) && <Field label="Perfil" wide><select name="role" defaultValue={modal.user?.role || roles[0][0]}>{roles.map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></Field>}
        {['new','password'].includes(modal.type) && <Field label="Senha provisória" name="password" type="password" minLength={12} maxLength={72} autoComplete="new-password" required wide />}
        {modal.type !== 'new' && <p className="wide">As sessões desse usuário serão encerradas. Confirma a alteração?</p>}
        <div className="form-actions wide"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button" disabled={busy}><Check />{modal.type === 'new' ? 'Criar acesso' : 'Confirmar'}</button></div>
      </form>
    </Modal>}
  </>;
}
