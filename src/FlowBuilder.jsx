import { useState } from 'react';
import { ArrowRight, Clock3, GitBranch, MessageCircle, Play, Plus, Send, UserRound, X } from 'lucide-react';
import { PageTitle } from './ui.jsx';

const palette = [
  ['message', 'Enviar mensagem', MessageCircle, 'purple'],
  ['question', 'Aguardar resposta', UserRound, 'blue'],
  ['condition', 'Condição', GitBranch, 'amber'],
  ['transfer', 'Falar com atendente', Send, 'teal'],
  ['wait', 'Aguardar tempo', Clock3, 'pink'],
  ['finish', 'Finalizar', X, 'gray'],
];
const initial = [
  { type: 'message', title: 'Boas-vindas', text: 'Olá! Como podemos ajudar?', x: 24, y: 28 },
  { type: 'question', title: 'Dados do pet', text: 'Nome, espécie e idade', x: 300, y: 28 },
  { type: 'transfer', title: 'Recepção', text: 'Encaminhar para atendimento humano', x: 576, y: 28 },
];

export default function FlowBuilder() {
  const [blocks, setBlocks] = useState(initial);
  const [selected, setSelected] = useState(null);
  const add = (type) => setBlocks((items) => [...items, { type, title: palette.find(([id]) => id === type)?.[1], text: 'Configure este bloco', x: 24 + (items.length % 3) * 276, y: 180 + Math.floor(items.length / 3) * 150 }]);
  return <section className="flow-builder-page">
    <PageTitle title="Fluxos de atendimento" subtitle="Monte respostas automáticas aprovadas para o WhatsApp."><button className="primary-button" onClick={() => setBlocks(initial)}><Play />Testar fluxo</button></PageTitle>
    <div className="flow-toolbar"><div><strong>Fluxo principal</strong><small>Alterações salvas neste dispositivo</small></div><button className="secondary-button" onClick={() => add('message')}><Plus />Adicionar bloco</button></div>
    <div className="flow-layout"><div className="flow-canvas">
      {blocks.map((block, index) => { const [, label, Icon, tone] = palette.find(([id]) => id === block.type) || palette[0]; return <button key={`${block.type}-${index}`} className={`flow-block flow-${tone}`} style={{ left: block.x, top: block.y }} onClick={() => setSelected(index)}><span className="flow-icon"><Icon /></span><strong>{block.title || label}</strong><small>{block.text}</small>{index < blocks.length - 1 && <ArrowRight className="flow-arrow" />}</button>; })}
      {!blocks.length && <div className="flow-empty">Adicione um bloco para começar o fluxo.</div>}
    </div><aside className="flow-palette"><strong>Blocos</strong><small>Adicione etapas ao fluxo</small>{palette.map(([id, label, Icon, tone]) => <button key={id} className={`palette-item flow-${tone}`} onClick={() => add(id)}><Icon /><span>{label}</span><small>{id === 'condition' ? 'Divide caminhos de atendimento' : 'Adiciona uma etapa ao fluxo'}</small></button>)}</aside></div>
    {selected !== null && <div className="flow-editor"><strong>Editar bloco</strong><button className="icon-button" title="Fechar edição" onClick={() => setSelected(null)}><X /></button><label>Título<input value={blocks[selected].title} onChange={(e) => setBlocks((items) => items.map((item, i) => i === selected ? { ...item, title: e.target.value } : item))} /></label><label>Conteúdo<textarea rows="3" value={blocks[selected].text} onChange={(e) => setBlocks((items) => items.map((item, i) => i === selected ? { ...item, text: e.target.value } : item))} /></label></div>}
  </section>;
}
