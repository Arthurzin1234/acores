import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, Clock3, GitBranch, MapPin, MessageCircle, Pencil, Play, Plus, Scissors, Send, Trash2, UserRound, X } from 'lucide-react';
import { PageTitle } from './ui.jsx';

const palette = [
  ['message', 'Enviar mensagem', MessageCircle, 'purple', 'Responde com um texto aprovado'],
  ['question', 'Perguntar dados', UserRound, 'blue', 'Nome, espécie, idade ou outro dado'],
  ['condition', 'Condição', GitBranch, 'amber', 'Divide o fluxo em Sim e Não'],
  ['surgery', 'Cirurgia', Scissors, 'red', 'Alerta e coleta dados do procedimento'],
  ['address', 'Endereço', MapPin, 'cyan', 'Envia o endereço e link do Maps'],
  ['hours', 'Horário', Clock3, 'orange', 'Responde o horário de atendimento'],
  ['transfer', 'Falar com atendente', Send, 'teal', 'Transfere e pausa a IA'],
  ['ai', 'Fallback IA', Bot, 'violet', 'Usa a IA se nenhum bloco combinar'],
  ['wait', 'Aguardar tempo', Clock3, 'pink', 'Espera antes de continuar'],
  ['finish', 'Finalizar', X, 'gray', 'Encerra o fluxo'],
];

const defaults = {
  message: ['Enviar mensagem', 'Quando receber uma mensagem, responder com:'],
  question: ['Perguntar dados do pet', 'Qual é o nome, espécie e idade do seu pet?'],
  condition: ['Condição', 'Se a mensagem contiver:'],
  surgery: ['Cirurgia / emergência', 'Piscar alerta por 10 segundos e encaminhar para a recepção.'],
  address: ['Endereço da clínica', 'Se pedirem endereço, enviar o endereço e o link do Maps.'],
  hours: ['Horário de atendimento', 'Se perguntarem horário, responder com o horário cadastrado.'],
  transfer: ['Falar com atendente', 'Se pedir atendimento humano, pausar a IA e encaminhar.'],
  ai: ['Fallback IA', 'Se nenhum bloco combinar, responder usando a IA aprovada.'],
  wait: ['Aguardar tempo', 'Aguardar 5 segundos antes de responder.'],
  finish: ['Finalizar', 'Encerrar este fluxo.'],
};

const initial = [
  { id: 'welcome', type: 'message', title: 'Boas-vindas', text: 'Olá! Como podemos ajudar?', x: 24, y: 28 },
  { id: 'pet', type: 'question', title: 'Dados do pet', text: 'Nome, espécie e idade', x: 300, y: 28, choices: 'Sim / Não' },
  { id: 'reception', type: 'transfer', title: 'Recepção', text: 'Encaminhar para atendimento humano', x: 576, y: 28 },
];

function metadata(type) { return palette.find(([id]) => id === type) || palette[0]; }

export default function FlowBuilder() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('acores-flow-beta') === '1');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [blocks, setBlocks] = useState(() => { try { return JSON.parse(localStorage.getItem('acores-flow')) || initial; } catch { return initial; } });
  const [selected, setSelected] = useState(null);
  const [menu, setMenu] = useState(null);
  const [drag, setDrag] = useState(null);
  const [connectSource, setConnectSource] = useState(null);
  const [connections, setConnections] = useState(() => { try { return JSON.parse(localStorage.getItem('acores-flow-connections')) || []; } catch { return []; } });
  const canvasRef = useRef(null);
  const selectedBlock = useMemo(() => blocks.find((block) => block.id === selected), [blocks, selected]);

  useEffect(() => { localStorage.setItem('acores-flow', JSON.stringify(blocks)); }, [blocks]);
  useEffect(() => { localStorage.setItem('acores-flow-connections', JSON.stringify(connections)); }, [connections]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const update = (id, patch) => setBlocks((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const add = (type) => {
    const [label, text] = defaults[type] || ['Novo bloco', 'Configure este bloco'];
    const id = `${type}-${Date.now()}`;
    setBlocks((items) => [...items, { id, type, title: label, text, x: 24 + (items.length % 3) * 276, y: 190 + Math.floor(items.length / 3) * 150, choices: type === 'condition' || type === 'question' ? 'Sim / Não' : '' }]);
    setSelected(id);
  };
  const remove = (id) => { setBlocks((items) => items.filter((item) => item.id !== id)); if (selected === id) setSelected(null); setMenu(null); };
  const connect = (id) => { if (!connectSource) { setConnectSource(id); return; } if (connectSource !== id) setConnections((items) => items.some((item) => item.from === connectSource && item.to === id) ? items : [...items, { from: connectSource, to: id }]); setConnectSource(null); };
  const blockCenter = (id, side) => { const item = blocks.find((block) => block.id === id); if (!item) return [0, 0]; return [item.x + (side === 'right' ? 240 : 0), item.y + 54]; };
  const move = (event) => {
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    update(drag.id, { x: Math.max(8, event.clientX - rect.left - drag.dx), y: Math.max(8, event.clientY - rect.top - drag.dy) });
  };

  const unlock = (event) => {
    event.preventDefault();
    if (password === 'arthurph3001') {
      sessionStorage.setItem('acores-flow-beta', '1');
      setUnlocked(true);
      setPasswordError('');
    } else {
      setPasswordError('Senha incorreta.');
    }
  };

  return <section className="flow-builder-page">
    <PageTitle title="Fluxos de atendimento" subtitle="Área em beta para montar respostas automáticas aprovadas."><span className="beta-badge">BETA</span>{unlocked && <button className="primary-button" onClick={() => setBlocks(initial)}><Play />Testar fluxo</button>}</PageTitle>
    {!unlocked && <div className="flow-beta-lock"><div><strong>Construtor de fluxos em beta</strong><p>Esta área ainda está em testes. Informe a senha de acesso para visualizar e editar os blocos.</p></div><form onSubmit={unlock}><label>Senha de acesso<input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setPasswordError(''); }} autoFocus placeholder="Digite a senha" /></label><button className="primary-button" type="submit">Desbloquear</button>{passwordError && <small className="flow-password-error">{passwordError}</small>}</form></div>}
    <div className={unlocked ? '' : 'flow-locked-content'} aria-hidden={!unlocked}>
    <div className="flow-toolbar"><div><strong>Fluxo principal</strong><small>Arraste os blocos e clique com o botão direito para editar.</small></div><button className="secondary-button" onClick={() => add('message')}><Plus />Adicionar bloco</button></div>
    <div className="flow-layout"><div ref={canvasRef} className="flow-canvas" onMouseMove={move} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
      <svg className="flow-connections" aria-hidden="true">{connections.map((connection, index) => { const [x1, y1] = blockCenter(connection.from, 'right'); const [x2, y2] = blockCenter(connection.to, 'left'); return <path key={`${connection.from}-${connection.to}-${index}`} d={`M ${x1} ${y1} C ${x1 + 70} ${y1}, ${x2 - 70} ${y2}, ${x2} ${y2}`} />; })}</svg>
      {blocks.map((block) => { const [, label, Icon, tone] = metadata(block.type); return <button key={block.id} className={`flow-block flow-${tone} ${block.flash ? 'flow-flash' : ''} ${connectSource === block.id ? 'flow-connect-source' : ''}`} style={{ left: block.x, top: block.y }} onClick={() => { if (!drag) connect(block.id); setSelected(block.id); }} onDoubleClick={(event) => { event.stopPropagation(); setConnectSource(block.id); }} onMouseDown={(event) => { if (event.button === 0) { const rect = event.currentTarget.getBoundingClientRect(); setDrag({ id: block.id, dx: event.clientX - rect.left, dy: event.clientY - rect.top }); } }} onContextMenu={(event) => { event.preventDefault(); setSelected(block.id); setMenu({ id: block.id, x: event.clientX, y: event.clientY }); }}><span className="flow-icon"><Icon /></span><strong>{block.title || label}</strong><small>{block.text}</small>{block.choices && <em>{block.choices}</em>}</button>; })}
      {!blocks.length && <div className="flow-empty">Adicione um bloco para começar o fluxo.</div>}
      {menu && <div className="flow-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => { setSelected(menu.id); setMenu(null); }}><Pencil />Editar</button><button onClick={() => remove(menu.id)}><Trash2 />Excluir</button></div>}
    </div><aside className="flow-palette"><strong>Blocos</strong><small>Adicione etapas ao fluxo</small>{palette.map(([id, label, Icon, tone, help]) => <button key={id} className={`palette-item flow-${tone}`} onClick={() => add(id)}><Icon /><span>{label}</span><small>{help}</small></button>)}</aside></div>
    {selectedBlock && <div className="flow-editor"><div className="flow-editor-heading"><strong>Editar bloco</strong><button className="icon-button" title="Fechar edição" onClick={() => setSelected(null)}><X /></button></div><label>Título<input value={selectedBlock.title} onChange={(e) => update(selectedBlock.id, { title: e.target.value })} /></label><label>Quando / instrução<textarea rows="2" value={selectedBlock.text} onChange={(e) => update(selectedBlock.id, { text: e.target.value })} /></label>{(selectedBlock.type === 'condition' || selectedBlock.type === 'question') && <label>Opções de resposta<input value={selectedBlock.choices || ''} onChange={(e) => update(selectedBlock.id, { choices: e.target.value })} placeholder="Sim / Não" /></label>}{selectedBlock.type === 'surgery' && <div className="flow-choice-grid"><label className="flow-toggle"><input type="checkbox" checked={Boolean(selectedBlock.flash)} onChange={(e) => update(selectedBlock.id, { flash: e.target.checked })} /> Piscar alerta</label><label>Segundos<input className="short-input" type="number" min="1" max="60" value={selectedBlock.flashSeconds || 10} onChange={(e) => update(selectedBlock.id, { flashSeconds: Number(e.target.value) })} /></label></div>}<button className="danger-button" onClick={() => remove(selectedBlock.id)}><Trash2 />Excluir bloco</button></div>}
    </div>
  </section>;
}
