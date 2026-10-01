import test from "node:test";
import assert from "node:assert/strict";
import { collectPatient } from "../server/patient-intake.js";
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
