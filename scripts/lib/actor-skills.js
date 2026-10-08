/**
 * Extrait la liste des compétences d'un acteur CoC7 sous une forme utilisable
 * par le sélecteur de l'app de config.
 * Structure validée : items[] de type "skill" avec system.skillName,
 * system.specialization, system.value (déjà un int = % affiché).
 * @param {Actor} actor
 * @returns {Array<{id: string, label: string, value: number}>}
 */
export function getActorSkills(actor) {
  if (!actor) return [];
  const skills = actor.items?.filter(i => i.type === "skill") ?? [];
  return skills
    .map(item => {
      const name = item.system?.skillName || item.name || "?";
      const spec = item.system?.specialization;
      const label = spec ? `${name} (${spec})` : name;
      const value = Number(item.system?.value ?? 0);
      return { id: item.id, label, value };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Récupère la valeur actuelle d'une compétence par id d'item.
 */
export function getSkillValue(actor, skillId) {
  const item = actor?.items?.get(skillId);
  return Number(item?.system?.value ?? 0);
}

/**
 * Résout la valeur d'une compétence par son libellé complet (nom + spécialisation
 * éventuelle), tel que construit par getActorSkills. Renvoie null si l'acteur
 * n'a pas cette compétence sur sa fiche.
 */
export function getSkillValueByLabel(actor, label) {
  const skill = getActorSkills(actor).find(s => s.label === label);
  return skill ? skill.value : null;
}

export const CHARACTERISTICS = [
  { key: "str", label: "Force" },
  { key: "con", label: "Constitution" },
  { key: "siz", label: "Taille" },
  { key: "dex", label: "Dextérité" },
  { key: "app", label: "Apparence" },
  { key: "int", label: "Intelligence" },
  { key: "pow", label: "Pouvoir" },
  { key: "edu", label: "Éducation" }
];

/**
 * Lit la valeur brute d'une caractéristique CoC7 sur la fiche d'acteur.
 * La cible du jet est conventionnellement caractéristique x5.
 */
export function getCharacteristicValue(actor, key) {
  const c = actor?.system?.characteristics?.[key];
  const raw = c?.value ?? c?.total ?? 0;
  return Number(raw) || 0;
}

export const SPECIAL_ATTRIBUTES = [
  { key: "san", label: "Santé Mentale" },
  { key: "luck", label: "Chance" }
];

/**
 * Lit la Chance ou la Santé Mentale sur la fiche. Contrairement aux
 * caractéristiques, ces valeurs s'utilisent directement comme cible du jet
 * (pas de x5). Plusieurs chemins possibles sont tentés car la structure
 * exacte de system.attribs n'a pas pu être vérifiée sur une fiche réelle —
 * à confirmer/ajuster si la valeur lue est incorrecte.
 */
export function getSpecialAttributeValue(actor, key) {
  if (!actor) return 0;
  const candidates = key === "san"
    ? [actor.system?.attribs?.san, actor.system?.sanity, actor.system?.san]
    : [actor.system?.attribs?.luck, actor.system?.luck];
  for (const node of candidates) {
    if (node && typeof node === "object" && "value" in node) return Number(node.value) || 0;
    if (typeof node === "number") return node;
  }
  return 0;
}

/**
 * Renvoie les utilisateurs non-MJ actuellement connectés qui possèdent
 * l'acteur (permission OWNER). Sert à router les requêtes de jet.
 */
export function getActiveOwners(actor) {
  if (!actor) return [];
  return game.users.filter(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
}
