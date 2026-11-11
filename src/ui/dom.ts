type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Minimal element factory. Text is always inserted as text nodes (never parsed as HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) {
      return;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
      return;
    }
    if (key === 'class') {
      element.className = String(value);
      return;
    }
    if (value === true) {
      element.setAttribute(key, '');
      return;
    }
    element.setAttribute(key, String(value));
  });
  append(element, ...children);
  return element;
}

export function append(parent: Node, ...children: Child[]): void {
  children.forEach((child) => {
    if (child === null || child === undefined || child === false) {
      return;
    }
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  });
}

const ICONS: Record<string, string> = {
  play: '<path d="M7 4v16l13-8z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  home: '<path d="M5 12H3l9-9 9 9h-2M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  infinity: '<path d="M9.8 8.6a4.6 4.6 0 1 0 0 6.8L12 12l2.2-3.4a4.6 4.6 0 1 1 0 6.8"/>',
  calendar:
    '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM16 3v4M8 3v4M4 11h16"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  settings:
    '<path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  help: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17v.01M12 13.5a1.5 1.5 0 0 1 1-1.5 2.6 2.6 0 1 0-3-4"/>',
  lock: '<path d="M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4"/>',
  restart: '<path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  volume:
    '<path d="M15 8a5 5 0 0 1 0 8M17.7 5a9 9 0 0 1 0 14M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5z"/>',
  mute: '<path d="M6 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5A.8.8 0 0 1 11 5v14a.8.8 0 0 1-1.5.5zM16 10l4 4m0-4-4 4"/>',
  copy: '<path d="M8 8h12v12H8z"/><path d="M16 8V4H4v12h4"/>',
  trash:
    '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  share:
    '<path d="M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrowRight: '<path d="M5 12h14M13 18l6-6-6-6"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  maximize: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>',
  heart: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6z"/>',
  github:
    '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  brush:
    '<path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12 15.6 8.4 12zM8.4 12c-2.4 0-4 1.6-4 4 0 1.5-.8 2.5-2 3 1.5 1 3.2 1.5 5 1.5 2.6 0 4.6-2 4.6-4.9"/>',
  eraser:
    '<path d="M7 21h13M5.6 15.6l8.5-8.5a2 2 0 0 1 2.8 0l2.1 2.1a2 2 0 0 1 0 2.8L11 20H7.4l-1.8-1.8a1.8 1.8 0 0 1 0-2.6zM9.5 11.5l5 5"/>',
  square: '<path d="M5 5h14v14H5z"/>',
  line: '<path d="M5 19 19 5"/><path d="M4 18h2v2H4zM18 4h2v2h-2z"/>',
  bucket:
    '<path d="M5 11 12 4l7 7-7 7zM5 11h14M20 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z"/>',
  picker:
    '<path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5zM12 7l5 5-8 8H4v-5z"/>',
  stamp: '<path d="M9 4h6v5l3 3v3H6v-3l3-3zM5 19h14"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  mirror: '<path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3v5h7V3M8 21v-7h8v7"/>',
  minus: '<path d="M5 12h14"/>',
  dice: '<path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M18 13l-6 6-6-6"/>',
  download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12"/>'
};

export function icon(name: keyof typeof ICONS | string, label?: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'icon';
  if (label) {
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', label);
  } else {
    span.setAttribute('aria-hidden', 'true');
  }
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return span;
}

export function clear(element: Element): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
