/*
 * Lowsper : compte rendu extractif (lot C1, decision.md §40).
 *
 * Repère, dans le transcript, les phrases prononcées qui portent une décision, une action ou une
 * question restée ouverte, et les rend telles quelles : rien n'est réécrit, rien n'est inventé.
 * Chaque phrase retenue est une sous-chaîne exacte d'une réplique du transcript, avec l'horodatage
 * et la personne de cette réplique.
 *
 * La méthode est faite de règles explicites (formules usuelles en français et en anglais), sans
 * modèle : instantanée sur un portable sans carte graphique, hors ligne, et vérifiable. Les règles
 * ont été réglées sur la moitié « dev » du corpus fictif (tools/test/corpus/compte-rendu.json) et
 * mesurées sur l'autre moitié et sur des corpus écrits avant ce lot (tools/test/eval-extract.mjs).
 *
 * Les deux jeux de règles s'appliquent quelle que soit la langue parlée : une phrase française ne
 * déclenche pas les formules anglaises, et une réunion qui mêle les deux langues reste couverte.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  // Limite de mot qui connaît les lettres accentuées (\b de JavaScript ne les connaît pas)
  const W = '[\\p{L}\\p{N}]';
  const BOUND = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
  /**
   * Expression régulière où « \b » est une limite de mot Unicode. src est toujours une chaîne
   * écrite en dur dans ce fichier, jamais une saisie : seules les limites de mot sont remplacées.
   * Mesuré (decision.md §50) : sur des textes piégés de 20 000 caractères, temps linéaire, quelques
   * dizaines de millisecondes ; un test unitaire le vérifie.
   */
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const rx = (src) => new RegExp(src.replace(/\\b/g, BOUND), 'u');
  const any = (list) => list.map(rx);
  const test = (list, s) => list.some((r) => r.test(s));

  /** Forme de comparaison : minuscules, apostrophe droite, espaces simples. */
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  const wordCount = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;

  /**
   * Découpe un texte en phrases, sans rien modifier : chaque phrase est une sous-chaîne exacte.
   * Coupe après « . », « ! », « ? » ou « … » suivis d'une espace.
   */
  function sentences(text) {
    const out = [];
    const s = String(text || '');
    const re = /[.!?…]+["»”)]*(?=\s)/g;
    let from = 0;
    let m;
    while ((m = re.exec(s))) {
      const end = m.index + m[0].length;
      const part = s.slice(from, end).trim();
      if (part) out.push(part);
      from = end;
    }
    const last = s.slice(from).trim();
    if (last) out.push(last);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Ce qui n'est pas une décision ni une action : hypothèse, rappel du passé, proposition
  // ---------------------------------------------------------------------------
  const NOT_NOW = any([
    // Français : hypothèse, conditionnel, passé lointain, plus-que-parfait
    "\\bsi (on|nous|j'|je|tu|vous|il|elle|ils|elles)\\b.{0,40}\\b(avai[st]|avaient|avions|aviez|étai[st]|étaient|étions)\\b",
    '\\b(pourrai[st]|pourrait|pourrions|pourriez|pourraient|aurai[st]|aurait|aurions|auraient) (pu|dû|été|eu)\\b',
    '\\b(on|nous|ils|elles|il|elle|ça|cela) (pourrait|pourrions|pourraient|devrait|devrions|faudrait)\\b',
    '\\b(en théorie|à une époque|par le passé|autrefois)\\b',
    '\\b(avai[st]|avaient|avions|aviez) \\p{L}+(é|ée|és|ées|i|is|it|u|us)\\b',
    '\\b(je (vous |te )?rappelle qu|pour rappel|comme convenu|comme prévu)\\b',
    // Anglais : hypothèse, conditionnel, passé
    '\\bif (we|i|you|they|he|she|it|someone) (had|were|did)\\b',
    '\\b(we|i|they|it|that|this|he|she) (could|would|might)\\b',
    '\\b(had|used to|ago|in the past|in theory|back then|back in|to remind|as agreed|as we agreed|as planned)\\b',
    '\\b(last year|last time|at the time)\\b.{0,60}\\b(decided|agreed|chose|was|were|did|tried|looked|went|bought|charged)\\b',
    '\\b(decided|agreed|chose|was|were|did|tried|looked|went|bought|charged)\\b.{0,60}\\b(last year|last time|at the time)\\b',
    '\\bkeep \\p{L}+ing\\b',
  ]);
  // Proposition encore discutée, souhait sans responsable
  const PROPOSAL = any([
    '\\bje (propose|suggère)\\b',
    '\\b(il faudrait|il faut que|faudrait-il|on devrait|ce serait bien)\\b',
    '\\b(i suggest|i propose|we should|someone should|it would be|maybe we)\\b',
  ]);

  // ---------------------------------------------------------------------------
  // Décisions
  // ---------------------------------------------------------------------------
  const DECISION = any([
    // Français
    "\\bc'est (décidé|validé|acté|tranché|entendu|réglé|arrêté)\\b",
    '\\b(on a|nous avons) (décidé|tranché|validé|retenu|choisi|acté|convenu|arrêté)\\b',
    "\\b(on|nous) (la |le |les |l'|y |en )?(retient|retenons|garde|gardons|conserve|conservons|maintient|maintenons|valide|validons|choisit|choisissons|prend|prenons|adopte|adoptons|abandonne|abandonnons|reporte|reportons|décale|décalons|annule|annulons|arrête|arrêtons|part sur|partons sur|opte pour|optons pour|décide|décidons|oublie|oublions|cale|calons|fixe|fixons|passe à|passons à|monte|montons|baisse|baissons|limite|limitons|fait passer|faisons passer|supprime|supprimons|remplace|remplaçons|repousse|repoussons)\\b",
    "\\b(donc|alors|bref|bon|c'est bon|d'accord|très bien|parfait),? (on|nous) (fait|faisons|va|allons|prend|prenons|reste|restons|met|mettons) (?!(essayer|voir|commencer|parler)\\b)(\\p{L}+ )?(\\p{L}+)",
    '\\bon va plutôt\\b',
    '\\b(on|nous) ne (fait|faisons|fera|ferons|commande|commandons|lance|lançons|prend|prenons|change|changeons|signe|signons|garde|gardons|publie|publions|recrute|recrutons|ouvre|ouvrons) (pas|rien|plus)\\b',
    "\\b(est|sont|sera|seront) (fixée?s?|arrêtée?s?|validée?s?|retenue?s?|actée?s?|maintenue?s?|reportée?s?|annulée?s?|décalée?s?) (au|à|le|la|les|pour|jusqu|en|d'ici)\\b",
    '\\b(restera|resteront|sera|seront) (fermée?s?|ouverte?s?|suspendue?s?|gelée?s?)\\b',
    '\\bva pour\\b',
    "\\b(désormais|dorénavant|à partir de maintenant|à partir d'aujourd'hui)\\b",
    '\\bpas de dérogation\\b',
    '\\bprochaine? (réunion|point|comité|séance|rendez-vous)\\b.{0,40}\\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|le \\p{L}+|à \\p{L}+ heures?)\\b',
    // Anglais
    "\\b(it's|it is|that's) (decided|settled|agreed|final|confirmed)\\b",
    "\\b(we|we've|we have) (decided|agreed|settled|chosen|opted)\\b",
    "\\blet's (go with|go for|drop|book|keep|cancel|postpone|stick with|use|pick|choose|skip|freeze|ship|launch|move the|push the)\\b",
    "\\bwe('ll| will)? (keep|cancel|drop|go with|go for|make an offer|choose|pick|postpone|book|approve|publish|ship|stick with|freeze|hire|reject)\\b",
    "\\bwe (won't|will not|don't|do not) (offer|do|ship|launch|change|sign|buy|order|hire|release|publish|open|extend)\\b",
    '\\b(from now on|going forward|from today|from next (week|month|monday|tuesday|wednesday|thursday|friday))\\b',
    "\\b(we're|we are) (dropping|not doing|not deleting|keeping|going with|cancelling|canceling|switching|moving|sticking with|not going|postponing|freezing)\\b",
    '\\bwe (quarantine|switch|limit|freeze|drop|cancel|keep|move|postpone|stop|start using)\\b',
    '\\b(the board|the committee|the team|everyone|we all) (agrees|agree|approves|approve|votes|vote|decides|decide) (on|to|that|for)\\b',
    '\\b(meeting|call|sync|session|review) (moves|is moved|is moving) to\\b',
    '\\b(is|are|will be) (set|fixed|scheduled|confirmed|moved|postponed|cancelled|canceled|frozen) (for|to|on|until)\\b',
    '\\bwill (close|open|start|end|stay) (at|on|until|closed|open)\\b',
    '\\bnext (meeting|sync|call|review|session) (is|on|will)\\b',
  ]);
  // Récapitulatif de fin de réunion : retenu tel quel (décisions, actions, points ouverts mêlés)
  const RECAP = any([
    '\\b(pour résumer|en résumé|je résume|je récapitule|récap|pour récapituler|récapitulons|je note les actions|les actions sont|relevé de décisions)\\b',
    '\\b(to sum up|to recap|recap|to wrap up|wrapping up|in summary|to summarize|action items are|the actions are)\\b',
  ]);
  const RECAP_ACTIONS = any(['\\b(actions?|action items?)\\b']);

  // ---------------------------------------------------------------------------
  // Actions : engagement de la personne qui parle, ou tâche confiée à quelqu'un
  // ---------------------------------------------------------------------------
  const WHEN = rx(
    "\\b(aujourd'hui|demain|ce soir|ce matin|cet après-midi|cette semaine|la semaine prochaine|semaine prochaine|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|d'ici|avant (le|la|les|de|lundi|mardi|mercredi|jeudi|vendredi|fin)|dès|tout de suite|prochaine?|fin du mois|après la réunion|today|tomorrow|tonight|this (week|afternoon|morning|evening)|next (week|month|monday|tuesday|wednesday|thursday|friday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by (the|end|next|tomorrow|tonight)|right after|asap)\\b"
  );
  // Verbes de tâche, à la première personne du présent ou du futur proche
  const TASK_FR =
    "(envoie|transmets|relance|prépare|contacte|appelle|rappelle|préviens|regarde|vérifie|rédige|mets|passe|fais|termine|finis|organise|réserve|écris|demande|partage|corrige|reprends|planifie|cale|bloque|transfère|ajoute|crée|installe|commande|lance|m'occupe|me charge|teste|chiffre|mets à jour|fixe|signe|contrôle|valide)";
  const ACTION = any([
    // Français : je m'en charge, je vais..., je relancerai..., je + verbe de tâche
    "\\b(je m'en (charge|occupe)|je (m'|me) (charge|occupe) de|je peux m'en (charger|occuper)|je prends (ça|le sujet|ce point))\\b",
    "\\b(on|nous|mon équipe|l'équipe|notre équipe) s'en (charge|occupe)\\b",
    "\\bje vais (m'|me |le |la |les |lui |leur |vous |l')?\\p{L}+(er|ir|re)\\b",
    "\\b(je|j') ?(l'|le |la |les |lui |leur |vous |te |en |y )?\\p{L}{2,}(rai)\\b",
    "\\bje (l'|le |la |les |lui |leur |vous |te |en |y |leur en |vous en )?" + TASK_FR + '\\b(?! qu)',
    "\\bje l'aurai\\b",
    "\\bje (peux|veux bien|m'engage à) (m'|me |le |la |les |lui |leur |vous |l'|en )?(?!(dire|voir|comprendre|imaginer|confirmer|répondre)\\b)\\p{L}+(er|ir|re)\\b",
    "\\bje (vois|regarde|m'arrange) avec\\b",
    // Français : tâche confiée (« Paul, tu envoies... », « vous m'envoyez... ? », « c'est pour toi »)
    "\\b(tu|vous) (peux|pourrais|pouvez|pourriez) (t'|te |vous |me |m'|lui |leur |les |l'|en |y )?(en )?\\p{L}+(er|ir|re)\\b.*\\?",
    "\\b(est|c'est) pour (toi|vous)\\b",
    // Anglais : engagement
    "\\b(i'll|i will|i'm going to|i am going to|i shall) (?!(be honest|see|say|admit|guess|be brief))\\p{L}+",
    '\\blet me (?!(think|see|be|say|ask you|know|guess|finish|explain|share my))\\p{L}+',
    "\\byou're (on|in charge of|handling|doing)\\b",
    "\\b(leave it with me|i'm on it|i'll take it|i'll take care|i can take (it|that|care))\\b",
    '\\bi can (?!(see|hear|say|imagine|tell|understand|confirm|share my|only))\\p{L}+',
    // Anglais : tâche confiée
    '\\b(can|could|would) you (?!(see|hear|repeat|say|tell me what|explain))\\p{L}+.*\\?',
    '\\byou (send|take|own|handle|ask|call|check|update|write|prepare|contact|follow up|draft|book|review|lead|organise|organize|coordinate)\\b',
  ]);
  // « tu envoies... », « vous m'envoyez... » : tâche confiée si elle est datée ou posée en question
  const ASSIGN_FR = rx(
    "\\b(tu|vous) (m'|me |lui |leur |les |l'|nous |en |y )?(envoies|envoyez|contactes|contactez|appelles|appelez|relances|relancez|prépares|préparez|transmets|transmettez|regardes|regardez|vérifies|vérifiez|rédiges|rédigez|fais|faites|prends|prenez|organises|organisez|réserves|réservez|préviens|prévenez|passes|passez|mets|mettez|écris|écrivez|demandes|demandez|t'occupes|vous occupez|te charges|vous chargez|gères|gérez)\\b"
  );
  // Formules sans contenu : rien à recopier
  const EMPTY = any([
    "^(oui|non|ok|okay|d'accord|entendu|ça marche|parfait|très bien|merci|will do|got it|sure|okay, i'll do it|i'll do it|yes)[ ,.!]*$",
  ]);

  // ---------------------------------------------------------------------------
  // Questions restées ouvertes
  // ---------------------------------------------------------------------------
  // Point déclaré non tranché, sans être posé en question
  const OPEN = any([
    '\\bon ne sait (pas|toujours pas|pas encore)\\b',
    '\\b(on|nous) ignor(e|ons)\\b',
    '\\breste (la question|à savoir|à voir|à confirmer|à définir|à trancher|à décider)\\b',
    '\\btoujours pas (de réponse|répondu|reçu|confirmé|envoyé|tranché)\\b',
    '\\bpas encore (de réponse|répondu|envoyé|reçu|confirmé|tranché|décidé|signé)\\b',
    "\\b(rien n'est|ce n'est pas encore) (signé|décidé|tranché|validé|confirmé)\\b",
    '\\b(point|question|sujet) (ouvert|en suspens|en attente)e?\\b',
    '\\bon attend (sa|leur|la|une|toujours la) réponse\\b',
    "\\b(il faut|faut) (l'accord|l'avis|la validation|le feu vert) d",
    "\\b(still )?(don't|do not) know (yet )?(whether|if|how|when|who|what|why)\\b",
    "\\bstill (don't|do not) know\\b",
    "\\b(haven't|have not|hasn't|has not) (yet )?(decided|confirmed|replied|answered|agreed|approved|signed)\\b",
    '\\bopen (point|question|issue)\\b',
    '\\bto be (confirmed|decided|determined)\\b',
    '\\b(no answer|no reply) yet\\b',
    '\\bstill waiting (for|on)\\b',
  ]);
  // Question technique ou de politesse : jamais retenue
  const META = any([
    "\\b(m'entend\\p{L}*|m'entendez|vous m'entendez|tu m'entends|vous me voyez|tu me vois|mon écran|le son|ma caméra|mon micro|ça va|vous allez bien)\\b",
    '\\b(hear me|see my screen|see me|you there|on mute|my camera|my audio|how are you)\\b',
  ]);
  // Réplique qui laisse la question sans réponse
  const NO_ANSWER = any([
    "\\b(je ne sais pas|je sais pas|aucune idée|bonne question|je n'ai pas la réponse|on verra|à voir|pas encore|il faudrait voir|je ne suis pas sûre?|ça dépend|je ne peux pas (te|vous) dire)\\b",
    "\\b(i don't know|no idea|not sure|i'm not sure|good question|good point|we'll see|not yet|that depends|it depends|let's move on|hard to say)\\b",
    "\\b(n'a|n'ont|ont pas|hasn't|haven't) (toujours )?(pas )?(encore )?(répondu|replied|answered)\\b",
    "\\b(personne n'a|personne ne sait|rien d'officiel|pour l'instant|on (en )?reparlera|la prochaine fois|on manque de temps|pas le temps|on n'en est pas là)\\b",
    "\\b(nobody (has|knows)|no one (has|knows)|nothing yet|no, nothing|for now|still waiting|let's not get into|come back to (it|that)|figure (that|it) out|next time|no time)\\b",
  ]);
  // Changement de sujet juste après la question
  const TOPIC = any([
    '^(il y a aussi|autre point|autre sujet|deuxième point|troisième point|point suivant|passons|on passe|bon, on passe)\\b',
    "^(next point|moving on|let's move on|another thing|next item|on another topic)\\b",
  ]);

  /**
   * Catégorie d'une phrase seule, sans le contexte : 'decision', 'action', 'question' (point
   * déclaré ouvert), 'ask' (question posée, ouverte ou non selon la réplique suivante) ou null.
   */
  function classify(sentence) {
    const s = norm(sentence);
    if (!s || wordCount(s) < 4 || test(EMPTY, s)) return null;
    if (test(RECAP, s)) return test(RECAP_ACTIONS, s) ? 'action' : 'decision';
    const interrogative = /\?\s*$/.test(s);
    if (interrogative && test(META, s)) return null;
    const notNow = test(NOT_NOW, s);
    if (test(OPEN, s)) return 'question';
    if (!notNow && !test(PROPOSAL, s)) {
      if (test(DECISION, s) && !interrogative) return 'decision';
      if (test(ACTION, s)) return 'action';
      if (ASSIGN_FR.test(s) && (interrogative || WHEN.test(s))) return 'action';
    }
    if (interrogative && wordCount(s) >= 5) return 'ask';
    return null;
  }

  /**
   * Phrases à recopier en haut de la note.
   * items : répliques dans l'ordre, { start, speaker, text } (speaker : nom affiché).
   * Retourne [{ kind: 'decision' | 'action' | 'question', start, speaker, text }], dans l'ordre
   * du transcript ; text est une sous-chaîne exacte d'une réplique.
   */
  // Phrase manifestement anglaise : plus de petits mots anglais que français (decision.md §49)
  const EN_WORDS = new Set(
    "the and you they we it's i'll i'm is are was to of that this with for on what don't can will be have".split(' ')
  );
  const FR_WORDS = new Set(
    "le la les des et je tu il elle on nous vous ils un une est sont pas que qui dans pour avec ce ça c'est de du au".split(
      ' '
    )
  );
  function looksEnglish(s) {
    let en = 0;
    let fr = 0;
    for (const w of norm(s).match(/[\p{L}']+/gu) || []) {
      if (EN_WORDS.has(w)) en++;
      if (FR_WORDS.has(w)) fr++;
    }
    return en >= 2 && en > fr;
  }

  /**
   * opts.langs : langues parlées de la réunion. Une réunion sans l'anglais ne reçoit pas de
   * phrase anglaise dans son compte rendu (extrait de vidéo, citation, passage mal reconnu).
   */
  function extract(items, opts) {
    const langs = opts && opts.langs;
    const noEnglish = Array.isArray(langs) && langs.length > 0 && !langs.includes('en');
    const flat = [];
    for (const it of items || []) {
      for (const text of sentences(it.text))
        flat.push({
          start: it.start,
          speaker: it.speaker,
          text,
          kind: noEnglish && looksEnglish(text) ? null : classify(text),
        });
    }
    const out = [];
    const skip = new Set();
    for (let i = 0; i < flat.length; i++) {
      const f = flat[i];
      if (skip.has(i) || !f.kind) continue;
      if (f.kind !== 'ask') {
        out.push({ kind: f.kind, start: f.start, speaker: f.speaker, text: f.text });
        continue;
      }
      // Question posée : ouverte si personne n'y répond, si la réponse est « je ne sais pas », si
      // la personne ajoute elle-même que le point n'est pas tranché, ou si la conversation change
      // de sujet. Ces phrases « je ne sais pas » ne sont pas recopiées : la question suffit.
      let j = i + 1;
      const own = [];
      while (j < flat.length && flat[j].speaker === f.speaker && flat[j].start - f.start < 20) own.push(j++);
      const reply = flat[j];
      const unsure = (k) => test(NO_ANSWER, norm(flat[k].text)) || flat[k].kind === 'question';
      const ownOpen = own.filter(unsure);
      const closeBy = reply && reply.start - f.start < 30;
      const r = closeBy ? norm(reply.text) : '';
      const replyOpen = closeBy && (test(NO_ANSWER, r) || test(TOPIC, r) || reply.kind === 'question');
      if (!closeBy || ownOpen.length || replyOpen) {
        out.push({ kind: 'question', start: f.start, speaker: f.speaker, text: f.text });
        for (const k of ownOpen) skip.add(k);
        if (replyOpen && reply.kind === 'question') skip.add(j);
      }
    }
    return out;
  }

  Lowsper.Extract = { extract, classify, sentences, looksEnglish, KINDS: ['decision', 'action', 'question'] };
})();
