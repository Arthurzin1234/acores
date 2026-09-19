import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App.jsx';
import { Identity } from '../../src/identity.js';
import { api } from '../../src/api.js';
import '../../src/styles.css';

// Isolated preview: no session, live customer records or WhatsApp connection.
const today=new Date().toISOString();
const client={id:1,name:'Tutora de teste',phone:'5500000000000',pet_name:'Hanna',species:'Felina',pet_age:'7 anos',ticket_count:1};
const ticket={id:1,client_id:1,client_name:client.name,pet_name:client.pet_name,phone:client.phone,subject:'Solicitacao de castracao',
  status:'novo',category:'cirurgia',human_required:true,created_at:today,updated_at:today};
const dashboard={
  company:{id:'acores',name:'Centro Veterinario dos Acores',primary:true},
  settings:{name:'Centro Veterinario dos Acores',unit:'Clinica Matriz',address:'R. Raul Cabral de Menezes, 467 - Centro, Viamao - RS, 94415-610',phone:''},
  clients:[client],tickets:[ticket],notifications:[],checklist:{},neonatal:[],staff:[],
  appointments:[{id:1,client_id:1,pet_name:client.pet_name,client_name:client.name,species:client.species,service:'consulta',scheduled_at:today.slice(0,16),status:'confirmado'}],
  whatsapp:{connected:true},ai:{knowledge:[]},
  stats:{totalTickets:1,openTickets:1,humanQueue:1,totalClients:1,unreadNotifications:0},
};
api.dashboard=async()=>dashboard;
api.users=async()=>[{id:1,email:'teste@example.invalid',username:'teste',role:'administrador',active:1}];
api.ticketMessages=async()=>({ticket,messages:[{id:1,direction:'inbound',body:'Gostaria de informacoes sobre castracao.',author:client.name,created_at:today}]});
window.WebSocket=class {
  constructor(){queueMicrotask(()=>this.onopen?.());}
  close(){this.onclose?.();}
};
createRoot(document.getElementById('root')).render(
  <Identity.Provider value={{id:1,role:'administrador',company:dashboard.company}}><App /></Identity.Provider>
);
