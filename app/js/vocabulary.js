/*
 * Lowsper : vocabulaire métier intégré et contexte donné à Whisper.
 *
 * Whisper reconnaît mal les sigles et les noms propres qu'il ne connaît pas (« l'NSI » pour
 * « l'ANSSI », « BIOCRM » pour « EBIOS RM », « carpéro hosting » pour « Kerberoasting »...).
 * Le remède le plus efficace est de lui donner, avant chaque passage, un « contexte » où ces
 * termes sont bien écrits : il en imite l'orthographe. Ce contexte réunit :
 *   1. le nom de la réunion (« Entretien Ombrelune » : le nom propre est alors bien écrit) ;
 *   2. les vocabulaires métier cochés dans les paramètres (listes ci-dessous) ;
 *   3. le glossaire personnel de l'utilisateur (prioritaire) ;
 *   4. éventuellement la fin du passage précédent de la même source (voir decision.md).
 *
 * Chaque vocabulaire porte aussi quelques corrections de déformations réellement observées
 * dans des transcripts (jamais de devinette : uniquement des formes sans autre sens possible
 * dans une réunion de ce domaine).
 */
(function () {
  'use strict';

  const Lowsper = (window.Lowsper = window.Lowsper || {});

  const PRESETS = {
    cyber: {
      label: 'Cybersécurité',
      terms:
        'ANSSI, EBIOS RM, SSI, RSSI, CISO, SOC, CSIRT, CERT, SIEM, EDR, PKI, Active Directory, NTLM, ' +
        'Kerberos, Kerberoasting, pass-the-hash, ORADAD, PingCastle, gMSA, SMBv1, EternalBlue, WannaCry, ' +
        'AppLocker, WDAC, CRL, OCSP, RSA, CSPN, CRA, NIS 2, DORA, ISO 27001, HDS, RGPD, II 901, ' +
        'Diffusion Restreinte, homologation, MCO, MCS, tiering, pentest, ransomware, MFA, IAM, PAM, ' +
        'BIA, PSSI, matrice de conformité, sensibilisation',
      fixes: [
        [/\b([Ll]['’]\s?)(?:NSI|NCI|ANSI|ANC|ANSII)\b/g, '$1ANSSI'],
        [/\b(?:NTRM|NTM|NTLN)\b/g, 'NTLM'],
        [/\b(?:E?BIO[CS]{1,2}[\s-]?RM|EBIOS-RM|EBIOSRM)\b/gi, 'EBIOS RM'],
        [/\bWann?a[\s-]?(?:krai|kraï|cry|crai)(?![\p{L}\p{N}])/giu, 'WannaCry'],
        [/(?<![\p{L}\p{N}])[EÉé]ternal[\s-]?Blue\b/giu, 'EternalBlue'],
        [/\bSMB\s?-?V\s?1\b/gi, 'SMBv1'],
        [/\b(?:App?[\s-]?locker|Apoker)\b/gi, 'AppLocker'],
        [/\bpass?e? (?:du|de|the|ze) hash\b/gi, 'pass-the-hash'],
        [/\b(?:carp[ée]ro|kerb[ée]ro|kerberos)[\s-]?(?:hosting|asting|roasting)\b/gi, 'Kerberoasting'],
      ],
    },
    it: {
      label: 'Informatique et cloud',
      terms:
        'Microsoft 365, Teams, SharePoint, Outlook, Azure, AWS, Kubernetes, Docker, ServiceNow, ITSM, ITIL, ' +
        'GLPI, SLA, API, CI/CD, DevOps, ERP, SAP, CRM, Salesforce, Power BI, Linux, Windows Server, VMware, ' +
        'datacenter, SaaS, backlog, sprint, ticket, incident, MCO',
      fixes: [
        [/\bShare[\s-]?point\b/gi, 'SharePoint'],
        [/\bService[\s-]?now\b/gi, 'ServiceNow'],
      ],
    },
    projet: {
      label: 'Gestion de projet',
      terms:
        'COPIL, COMEX, CODIR, KPI, ROI, RACI, PMO, MOA, MOE, recette, jalon, livrable, roadmap, ' +
        "planning, Agile, Scrum, go/no-go, RETEX, budget, arbitrage, RAO, appel d'offres, TMA",
      fixes: [],
    },
  };

  const split = (t) =>
    String(t || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  /** Glossaire complet : vocabulaires cochés puis glossaire personnel (sans doublons). */
  function merge(glossary, ids) {
    const seen = new Set();
    const out = [];
    const add = (term) => {
      const k = term.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(term);
    };
    for (const id of ids || []) if (PRESETS[id]) split(PRESETS[id].terms).forEach(add);
    split(glossary).forEach(add);
    return out.join(', ');
  }

  // Expression d'un mot ou groupe de mots entier, sans tenir compte de la casse ni des accents
  // proches (« mira bello », « Mira Bello »).
  function wordPattern(wrong) {
    const esc = String(wrong)
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '[\\s-]+');
    return new RegExp('(^|[^\\p{L}\\p{N}])(' + esc + ')(?![\\p{L}\\p{N}])', 'giu');
  }

  /** Remplace un mot ou groupe de mots entier. Retourne { text, count }. */
  function replaceWord(text, wrong, right) {
    let count = 0;
    const out = String(text).replace(wordPattern(wrong), (m, before) => {
      count++;
      return before + right;
    });
    return { text: out, count };
  }

  /**
   * Corrige les déformations connues : celles des vocabulaires cochés, puis vos propres
   * corrections (« Mira Bello » -> « Mirabelle »), apprises à la fin des réunions.
   */
  function fix(text, ids, userFixes) {
    let out = text;
    for (const id of ids || []) {
      const p = PRESETS[id];
      if (!p) continue;
      for (const [re, rep] of p.fixes) out = out.replace(re, rep);
    }
    for (const [wrong, right] of userFixes || []) if (wrong && right) out = replaceWord(out, wrong, right).text;
    return out;
  }

  /**
   * Contexte donné à Whisper avant chaque passage. Le moteur n'en garde que la fin
   * (200 jetons) : on met donc le plus important à la fin, juste avant le passage.
   */
  function prompt({ title, glossary, context }) {
    const parts = [];
    if (title)
      parts.push(
        String(title)
          .trim()
          .replace(/[.!?]*$/, '.')
      );
    if (glossary)
      parts.push(
        String(glossary)
          .trim()
          .replace(/[.,;]*$/, '.')
      );
    if (context) parts.push(String(context).trim());
    return parts.join(' ');
  }

  Lowsper.Vocabulary = { PRESETS, merge, fix, prompt, replaceWord };
})();
