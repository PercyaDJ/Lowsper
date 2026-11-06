/*
 * Lowsper : menu dessiné par Lowsper, composant commun (refonte, docs/refonte.md principe 2).
 *
 * Remplace les listes déroulantes natives là où l'interface le demande : coche devant le choix
 * actuel, sous-titre facultatif, entrées d'action après un séparateur (« Nouvel emplacement… »).
 * Accessible au clavier et aux lecteurs d'écran (motif « menu button » de WAI-ARIA) :
 *   - bouton : aria-haspopup="menu", aria-expanded ; Flèche bas ou haut l'ouvre ;
 *   - menu : role="menu", entrées role="menuitemradio" (aria-checked) ou role="menuitem" ;
 *   - flèches, Début, Fin pour se déplacer, Entrée ou Espace pour choisir, Échap pour fermer
 *     (le focus revient au bouton), Tab ferme le menu ; un clic ailleurs le ferme aussi.
 */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Lowsper = (root.Lowsper = root.Lowsper || {});

  /**
   * Relie un bouton et un conteneur de menu.
   * options :
   *   button, menu : éléments du document ;
   *   items() : [{ value, label, sub?, checked?, lang? }], relu à chaque ouverture ;
   *   actions() : [{ id, label }] (facultatif), entrées d'action après un séparateur ;
   *   onSelect(value), onAction(id).
   * Retourne { open, close, isOpen }.
   */
  function attach({ button, menu, items, actions, onSelect, onAction }) {
    const doc = button.ownerDocument;
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    if (!menu.id) menu.id = 'menu-' + Math.random().toString(36).slice(2, 8);
    button.setAttribute('aria-controls', menu.id);

    const entries = () => [...menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')];

    function render() {
      menu.replaceChildren();
      for (const it of items()) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(!!it.checked));
        b.dataset.value = it.value;
        if (it.lang) b.lang = it.lang;
        const check = doc.createElement('span');
        check.className = 'check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        const text = doc.createElement('span');
        text.className = 'menu-text';
        const label = doc.createElement('span');
        label.className = 'menu-label';
        label.textContent = it.label;
        text.appendChild(label);
        if (it.sub) {
          const sub = doc.createElement('span');
          sub.className = 'menu-sub';
          sub.textContent = it.sub;
          text.appendChild(sub);
        }
        b.append(check, text);
        b.addEventListener('click', () => {
          close(true);
          if (onSelect) onSelect(it.value);
        });
        menu.appendChild(b);
      }
      const extra = actions ? actions() : [];
      if (extra.length) {
        const sep = doc.createElement('div');
        sep.className = 'menu-sep';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        for (const a of extra) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'menuitem');
          b.className = 'menu-action';
          b.dataset.action = a.id;
          b.textContent = a.label;
          b.addEventListener('click', () => {
            close(false);
            if (onAction) onAction(a.id);
          });
          menu.appendChild(b);
        }
      }
    }

    function open(focusLast) {
      render();
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      const list = entries();
      const current = list.find((b) => b.getAttribute('aria-checked') === 'true');
      (focusLast ? list[list.length - 1] : current || list[0]).focus();
    }

    function close(focusButton) {
      if (menu.hidden) return;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
    }

    const isOpen = () => !menu.hidden;

    button.addEventListener('click', () => (isOpen() ? close() : open()));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        open(e.key === 'ArrowUp');
      }
    });
    menu.addEventListener('keydown', (e) => {
      const list = entries();
      const i = list.indexOf(doc.activeElement);
      const go = (j) => {
        e.preventDefault();
        list[(j + list.length) % list.length].focus();
      };
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'Escape') {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') close(false);
    });
    // Clic ailleurs : le menu se ferme
    doc.addEventListener('click', (e) => {
      if (isOpen() && !menu.contains(e.target) && !button.contains(e.target)) close(false);
    });
    return { open, close, isOpen, render };
  }

  Lowsper.Menu = { attach };
})();
