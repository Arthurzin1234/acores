import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Field } from "./ui.jsx";
import { api } from "./api.js";

export default function AISettings({ dashboard, busy, run }) {
  const [form, setForm] = useState({ knowledge: dashboard.ai?.knowledge || [] });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function updateFact(id, key, value) {
    update("knowledge", form.knowledge.map((item) => item.id === id ? { ...item, [key]: value } : item));
  }
  async function save(event) {
    event.preventDefault();
    await run(() => api.saveAISettings({ knowledge: form.knowledge }), "Respostas aprovadas salvas.");
  }
  return (
    <section className="ai-settings">
      <form onSubmit={save}>
        <div className="section-heading knowledge-heading">
          <h2>Respostas aprovadas da clínica</h2>
          <button
            type="button"
            className="secondary-button"
            disabled={form.knowledge.length >= 60}
            onClick={() =>
              update("knowledge", [
                ...form.knowledge,
                { id: crypto.randomUUID(), question: "", answer: "" },
              ])
            }
          >
            <Plus />
            Adicionar resposta
          </button>
        </div>
        {!form.knowledge.length && (
          <p className="knowledge-empty">
            Nenhuma resposta cadastrada. Dúvidas sobre valores, serviços e
            horários serão encaminhadas à recepção.
          </p>
        )}
        <div className="knowledge-list">
          {form.knowledge.map((item, index) => (
            <div className="knowledge-item" key={item.id}>
              <span className="knowledge-number">{index + 1}</span>
              <div>
                <Field
                  label="Pergunta do cliente"
                  required
                  maxLength={300}
                  value={item.question}
                  onChange={(e) =>
                    updateFact(item.id, "question", e.target.value)
                  }
                />
                <Field label="Resposta aprovada">
                  <textarea
                    rows={3}
                    required
                    maxLength={2000}
                    value={item.answer}
                    onChange={(e) =>
                      updateFact(item.id, "answer", e.target.value)
                    }
                  />
                </Field>
              </div>
              <button
                type="button"
                className="icon-button"
                title={`Remover resposta ${index + 1}`}
                onClick={() =>
                  update(
                    "knowledge",
                    form.knowledge.filter((fact) => fact.id !== item.id),
                  )
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button disabled={busy} className="primary-button">
            <Save />
            Salvar respostas
          </button>
        </div>
      </form>
    </section>
  );
}
