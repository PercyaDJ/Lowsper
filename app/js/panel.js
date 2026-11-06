/*
 * Lowsper : panneau de réglages en onglets et sous-écrans, composant commun (lot R7,
 * docs/refonte.md §8, decision.md §30).
 *
 * Trois briques, accessibles au clavier et aux lecteurs d'écran (motifs WAI-ARIA) :
 *   - tabs : onglets (role="tablist") ; flèches gauche et droite, Début, Fin ;
 *   - pages : sous-écrans d'une fenêtre <dialog>. Un bouton [data-open="id"] ouvre la page
 *     #page-id, [data-back] revient à l'écran principal, Échap aussi (au lieu de fermer la
 *     fenêtre). Le focus va au titre de la page, puis revient sur la ligne qui l'a ouverte ;
 *   - choices / checklist : listes à cocher dessinées par Lowsper, à la place des listes
 *     déroulantes natives (principe 2). Choix unique : role="radiogroup", flèches haut et bas
 *     (le choix suit le focus), Espace ou Entrée. Choix multiple : role="checkbox".
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  /** Onglets : tablist contient les boutons [role=tab] (aria-controls = id du panneau). */
  function tabs(tablist, onChange) {
    const all = () => [...tablist.querySelectorAll('[role="tab"]')];
    function select(tab, focus) {
      for (const t of all()) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = tablist.ownerDocument.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      }
      if (focus) tab.focus();
      if (onChange) onChange(tab.dataset.tab);
    }
    tablist.addEventListener('click', (e) => {
      const t = e.target.closest('[role="tab"]');
      if (t) select(t, false);
    });
    tablist.addEventListener('keydown', (e) => {
      const list = all();
      const i = list.indexOf(tablist.ownerDocument.activeElement);
      if (i < 0) return;
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % list.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = list.length - 1;
      if (j === null) return;
      e.preventDefault();
      select(list[j], true);
    });
    return {
      select: (id) => {
        const t = all().find((x) => x.dataset.tab === id);
        if (t) select(t, false);
      },
      current: () => (all().find((t) => t.getAttribute('aria-selected') === 'true') || {}).dataset.tab,
    };
  }

  /**
   * Sous-écrans d'une fenêtre : main est l'écran principal, chaque page a l'id « page-<nom> ».
   * onOpen(nom) est appelé avant l'affichage d'une page (pour la remplir).
   */
  function pages(dialog, main, onOpen) {
    const doc = dialog.ownerDocument;
    let opener = null;
    let current = null;
    function show(name, from) {
      const page = doc.getElementById('page-' + name);
      if (!page) return;
      if (onOpen) onOpen(name);
      for (const p of dialog.querySelectorAll('.set-page')) p.hidden = p !== page;
      main.hidden = true;
      opener = from || null;
      current = name;
      const scroller = page.querySelector('.settings-body');
      if (scroller) scroller.scrollTop = 0;
      const title = page.querySelector('h2');
      if (title) {
        title.tabIndex = -1;
        title.focus();
      }
    }
    function back() {
      if (!current) return false;
      for (const p of dialog.querySelectorAll('.set-page')) p.hidden = true;
      main.hidden = false;
      current = null;
      if (opener && opener.isConnected && !opener.closest('[hidden]')) opener.focus();
      opener = null;
      return true;
    }
    dialog.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open && !open.disabled) return show(open.dataset.open, open);
      if (e.target.closest('[data-back]')) back();
    });
    // Échap dans un sous-écran : retour à l'écran principal, la fenêtre reste ouverte
    dialog.addEventListener('cancel', (e) => {
      if (current) {
        e.preventDefault();
        back();
      }
    });
    dialog.addEventListener('close', () => back());
    return { show, back, current: () => current };
  }

  function tick(doc) {
    const t = doc.createElement('span');
    t.className = 'tick';
    t.setAttribute('aria-hidden', 'true');
    t.textContent = '✓';
    return t;
  }

  function row(doc, it) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'set-row choice';
    b.dataset.value = it.value;
    if (it.lang) b.lang = it.lang;
    if (it.disabled) b.disabled = true;
    const text = doc.createElement('span');
    text.className = 'set-text';
    const label = doc.createElement('span');
    label.className = 'set-label';
    label.textContent = it.label;
    text.appendChild(label);
    if (it.sub) {
      const sub = doc.createElement('span');
      sub.className = 'set-sub';
      sub.textContent = it.sub;
      text.appendChild(sub);
    }
    b.append(text, tick(doc));
    return b;
  }

  /**
   * Choix unique. options : [{ value, label, sub?, lang?, disabled? }]. Le choix est appliqué
   * dès le clic ou la flèche (comme un groupe de boutons radio).
   */
  function choices(box, { options, value, onPick }) {
    const doc = box.ownerDocument;
    // Liste redessinée pendant qu'on l'utilise au clavier (un choix qui change la langue, le
    // thème...) : le focus revient sur le choix actuel au lieu de se perdre
    const hadFocus = box.contains(doc.activeElement);
    box.setAttribute('role', 'radiogroup');
    box.replaceChildren();
    const items = options.map((o) => {
      const b = row(doc, o);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      b.tabIndex = o.value === value ? 0 : -1;
      b.addEventListener('click', () => pick(b, false));
      box.appendChild(b);
      return b;
    });
    if (!items.some((b) => b.tabIndex === 0) && items[0]) items[0].tabIndex = 0;
    if (hadFocus) {
      const cur = items.find((b) => b.tabIndex === 0);
      if (cur) cur.focus();
    }
    function pick(b, focus) {
      for (const x of items) {
        const on = x === b;
        x.setAttribute('aria-checked', String(on));
        x.tabIndex = on ? 0 : -1;
      }
      if (focus) b.focus();
      if (onPick) onPick(b.dataset.value);
    }
    box.onkeydown = (e) => {
      const usable = items.filter((b) => !b.disabled);
      const i = usable.indexOf(doc.activeElement);
      if (i < 0) return;
      let j = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % usable.length;
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + usable.length) % usable.length;
      if (j === null) return;
      e.preventDefault();
      pick(usable[j], true);
    };
  }

  /** Choix multiple. options : [{ value, label, sub? }], values : valeurs cochées. */
  function checklist(box, { options, values, onToggle }) {
    const doc = box.ownerDocument;
    const focused = box.contains(doc.activeElement) ? doc.activeElement.dataset.value : null;
    box.replaceChildren();
    const on = new Set(values || []);
    for (const o of options) {
      const b = row(doc, o);
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', String(on.has(o.value)));
      b.addEventListener('click', () => {
        const now = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', String(now));
        if (onToggle) onToggle(o.value, now);
      });
      box.appendChild(b);
      if (o.value === focused) b.focus();
    }
  }

  Lowsper.Panel = { tabs, pages, choices, checklist };
})();
