import test from "node:test";
import assert from "node:assert/strict";
import { collectPatient, schedulingStep } from "../server/patient-intake.js";
const history = (body) => [{ direction: "outbound", body }];

test("pet answers populate only the requested field and ask for missing data", () => {
  const result = collectPatient("Hanna", history("Qual é o nome do seu pet?"), {});
  assert.deepEqual(result.patch, { pet_name: "Hanna" });
  assert.match(result.nextQuestion, /espécie/);
  const species = collectPatient("Gata", history(result.nextQuestion), { pet_name: "Hanna" });
  assert.equal(species.patch.species, "Felina");
  assert.match(species.nextQuestion, /idade/);
  const ambiguous = collectPatient("7", history(species.nextQuestion), { pet_name: "Hanna", species: "Felina" });
  assert.equal(ambiguous.patch.pet_age, "7 anos");
  const normalizedAge = collectPatient("7 meses", history(species.nextQuestion), { pet_name: "Hanna", species: "Felina" });
  assert.equal(normalizedAge.patch.pet_age, "7 meses");
  assert.equal(normalizedAge.nextQuestion, undefined);
});

test("unrelated messages do not change a patient and known data is not requested again", () => {
  assert.deepEqual(collectPatient("Hanna", history("Como posso ajudar?")).patch, {});
  assert.deepEqual(collectPatient("não sei", history("Qual é o nome do seu pet?")).patch, {});
  const result = collectPatient("Hanna", history("Qual é o nome do seu pet?"), { species: "Felina", pet_age: "7 anos" });
  assert.equal(result.nextQuestion, undefined);
});

test("combined answers are split into fields and remove conversational prefixes", () => {
  const result = collectPatient(
    "O tutor é Arthur, o nome do pet é Ronaldo, cachorro, 3 anos, sábado às 10h",
    history("Para agilizar, me informe juntos: nome do tutor, nome do pet, espécie, idade ou porte e o melhor dia."),
    {},
  );
  assert.deepEqual(result.patch, { name: "Arthur", pet_name: "Ronaldo", species: "Canina", pet_age: "3 anos" });
  assert.equal(result.complete, true);

  const short = collectPatient("é Ronaldo", history("Qual é o nome do seu pet?"), {});
  assert.equal(short.patch.pet_name, "Ronaldo");
});

test("the one-message scheduling questionnaire is complete without a pet name", () => {
  const result = collectPatient(
    "Nome do tutor: Arthur\nEspécie: cachorro\nIdade: 3 anos\nMelhor dia e horário: sábado às 10h",
    history("Nome do tutor: Espécie do pet: Idade do pet: Melhor dia e horário para a recepção retornar:"),
    {},
  );
  assert.deepEqual(result.patch, { name: "Arthur", species: "Canina", pet_age: "3 anos" });
  assert.equal(result.requestedSlot, "sábado às 10h");
  assert.equal(result.complete, true);
});

test("a compact form answer is understood without labels or line breaks", () => {
  const result = collectPatient(
    "Kamily gato 6 anos agendar amanhã",
    history("Nome do tutor: Espécie do pet: Idade do pet: Melhor dia e horário para a recepção retornar:"),
    {},
  );
  assert.deepEqual(result.patch, { name: "Kamily", species: "Felina", pet_age: "6 anos" });
  assert.equal(result.requestedSlot, "amanhã");
  assert.equal(result.complete, true);
});

test("a multiline WhatsApp form answer is completed in one response", () => {
  const result = collectPatient(
    "Roger\nCanino\n7 anos\nHoje",
    history("🐶 Me passa algumas informações, por favor?\nNome do tutor:\nEspécie do pet:\nIdade do pet:\nMelhor dia e horário para a recepção retornar:"),
    {},
  );
  assert.deepEqual(result.patch, { name: "Roger", species: "Canina", pet_age: "7 anos" });
  assert.equal(result.requestedSlot, "Hoje");
  assert.equal(result.complete, true);
});

test("scheduling asks only for the missing date and time of a registered client", () => {
  const client = { name: 'Roger', pet_name: 'Bob', species: 'Canina', pet_age: '7 anos' };
  const first = schedulingStep('Quero agendar uma consulta', [], client);
  assert.equal(first.reply, 'Qual dia você gostaria de agendar?');
  const day = schedulingStep('Amanhã', [{ direction: 'inbound', body: 'Quero agendar uma consulta' }], client);
  assert.equal(day.reply, 'Qual horário você prefere?');
  const complete = schedulingStep('14:00', [{ direction: 'inbound', body: 'Quero agendar uma consulta' }, { direction: 'inbound', body: 'Amanhã' }], client);
  assert.equal(complete.complete, true);
  assert.match(complete.summary, /Data desejada: Amanhã/);
  assert.match(complete.summary, /Horário desejado: 14:00/);
});

test("surgery gathers one missing datum at a time", () => {
  const first = schedulingStep('Quero marcar uma castração', [], { name: 'Cliente sem nome' });
  assert.equal(first.reply, 'Qual é o nome do tutor?');
  const pet = schedulingStep('Bob', [{ direction: 'inbound', body: 'Quero marcar uma castração' }, { direction: 'outbound', body: 'Qual é o nome do tutor?' }, { direction: 'inbound', body: 'Roger' }], { name: 'Roger' });
  assert.equal(pet.reply, 'Qual é o nome do seu pet?');
});

test("a simple greeting never resumes an old scheduling flow", () => {
  const step = schedulingStep('ola', [
    { direction: 'inbound', body: 'Quero marcar uma castração' },
    { direction: 'outbound', body: 'Qual é o nome do tutor?' },
  ], { name: 'Cliente sem nome' });
  assert.equal(step, null);
});
