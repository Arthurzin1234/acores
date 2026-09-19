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
  assert.deepEqual(ambiguous.patch, {});
  const age = collectPatient("7 meses", history(ambiguous.nextQuestion), { pet_name: "Hanna", species: "Felina" });
  assert.equal(age.patch.pet_age, "7 meses");
  assert.equal(age.nextQuestion, undefined);
});

test("unrelated messages do not change a patient and known data is not requested again", () => {
  assert.deepEqual(collectPatient("Hanna", history("Como posso ajudar?")).patch, {});
  assert.deepEqual(collectPatient("não sei", history("Qual é o nome do seu pet?")).patch, {});
  const result = collectPatient("Hanna", history("Qual é o nome do seu pet?"), { species: "Felina", pet_age: "7 anos" });
  assert.equal(result.nextQuestion, undefined);
});
