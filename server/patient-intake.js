const normalize = (text) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function collectPatient(text, history, client = {}) {
  const last = [...history].reverse().find((m) => m.direction === "outbound");
  const question = normalize(last?.body || "");
  const value = text.trim().replace(/[.!]+$/, "");
  const patch = {};
  if (/\b(atendente|humano|recepcao|emergencia|urgente|socorro)\b/.test(normalize(value)))
    return { patch };
  let expected;
  if (/nome do (seu )?pet/.test(question)) expected = "pet_name";
  else if (/nome do tutor/.test(question)) expected = "name";
  else if (/especie do (seu )?pet/.test(question)) expected = "species";
  else if (/idade do (seu )?pet|idade em meses ou anos/.test(question)) expected = "pet_age";
  if (!expected) return { patch };

  if (["name", "pet_name"].includes(expected)) {
    const name = value.replace(/^(?:meu nome [ée]|(?:o nome (?:dele|dela|do meu pet) [ée])|(?:ele|ela) se chama)\s+/i, "");
    if (/^[\p{L}][\p{L}\s'-]{0,59}$/u.test(name) && name.split(/\s+/).length <= 5 &&
        !/^(nao|sim|oi|ola|nao sei|obrigad[oa])$/.test(normalize(name))) patch[expected] = name;
  } else if (expected === "species") {
    const species = normalize(value).replace(/^(?:e |uma? )+/, "");
    if (/^(felin[ao]|gat[ao])$/.test(species)) patch.species = "Felina";
    else if (/^(canin[ao]|cachorr[ao]|cao|cadela)$/.test(species)) patch.species = "Canina";
    else if (/^(coelho|coelha|ave|passaro|hamster|porquinho da india|tartaruga)$/.test(species)) patch.species = value;
  } else {
    const age = normalize(value).match(/^(?:tem |ela tem |ele tem )?(\d{1,2}(?:[.,]\d{1,2})?)\s*(anos?|mes(?:es)?|dias?)$/);
    if (age) patch.pet_age = `${age[1]} ${age[2]}`;
  }

  const updated = { ...client, ...patch };
  let nextQuestion;
  if (!patch[expected]) nextQuestion = {
    name: "Qual é o nome do tutor?", pet_name: "Qual é o nome do seu pet?",
    species: "Qual é a espécie do seu pet?", pet_age: "Qual é a idade do seu pet, em meses ou anos?",
  }[expected];
  else if (!updated.pet_name) nextQuestion = "Qual é o nome do seu pet?";
  else if (!updated.species) nextQuestion = "Qual é a espécie do seu pet?";
  else if (!updated.pet_age) nextQuestion = "Qual é a idade do seu pet, em meses ou anos?";
  return { patch, nextQuestion };
}
