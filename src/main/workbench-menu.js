const { BrowserWindow } = require('electron');

const MENU_WIDTH = 220;
const MENU_HEADER_HEIGHT = 39;
const MENU_ITEM_HEIGHT = 32;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function menuIcon(id) {
  const common = 'width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (id === 'browser') return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>`;
  if (id === 'terminal') return `<svg ${common}><path d="m5 7 4 4-4 4M11 17h8"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>`;
  if (id === 'file-changes') return `<svg ${common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>`;
  if (id === 'trajectory') return `<svg ${common}><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>`;
  return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`;
}

function menuDocument({ heading, items, dark }) {
  const palette = dark
    ? { background: '#303033', border: '#49494d', text: '#f4f4f5', caption: '#aaaab0', hover: '#414145' }
    : { background: '#ffffff', border: '#d8d8dc', text: '#202124', caption: '#73737a', hover: '#f1f1f3' };
  const rows = items.map((item) => `
    <a role="menuitem" href="dsh-workbench-menu://select/${encodeURIComponent(item.id)}">
      ${menuIcon(item.id)}<span>${escapeHtml(item.label)}</span>
    </a>`).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;color:${palette.text};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;height:100%;padding:6px;border:1px solid ${palette.border};border-radius:8px;background:${palette.background};box-shadow:0 8px 24px rgba(0,0,0,.28)}
p{height:27px;margin:0;padding:5px 8px 6px;color:${palette.caption};font-size:11px;line-height:16px;letter-spacing:0}
a{display:flex;align-items:center;gap:9px;width:100%;height:32px;padding:6px 8px;border-radius:6px;color:${palette.text};font-size:13px;line-height:20px;letter-spacing:0;text-decoration:none;outline:none}
a:hover,a:focus-visible{background:${palette.hover}}svg{flex:none}
</style></head><body><main role="menu" aria-label="${escapeHtml(heading)}"><p>${escapeHtml(heading)}</p>${rows}</main>
<script>addEventListener('keydown',event=>{if(event.key==='Escape')location.href='dsh-workbench-menu://dismiss';const links=[...document.querySelectorAll('a')];const index=links.indexOf(document.activeElement);if(event.key==='ArrowDown'){event.preventDefault();links[(index+1+links.length)%links.length]?.focus()}if(event.key==='ArrowUp'){event.preventDefault();links[(index-1+links.length)%links.length]?.focus()}});</script>
</body></html>`;
}

class WorkbenchMenu {
  constructor({ getMainWindow }) {
    this.getMainWindow = getMainWindow;
    this.popup = null;
    this.pending = null;
    this.detachParent = null;
  }

  close(result = null) {
    const popup = this.popup;
    const pending = this.pending;
    this.popup = null;
    this.pending = null;
    this.detachParent?.();
    this.detachParent = null;
    if (popup && !popup.isDestroyed()) popup.destroy();
    pending?.(result);
  }

  show(payload = {}) {
    this.close();
    const parent = this.getMainWindow();
    if (!parent || parent.isDestroyed()) return Promise.resolve(null);
    const items = Array.isArray(payload.items)
      ? payload.items.slice(0, 12).flatMap((item) => {
        const id = typeof item?.id === 'string' ? item.id.slice(0, 80) : '';
        const label = typeof item?.label === 'string' ? item.label.slice(0, 120) : '';
        return id && label ? [{ id, label }] : [];
      })
      : [];
    if (items.length === 0) return Promise.resolve(null);

    const parentBounds = parent.getContentBounds();
    const width = MENU_WIDTH;
    const height = MENU_HEADER_HEIGHT + items.length * MENU_ITEM_HEIGHT;
    const localX = Math.round(Number(payload.x) || 0);
    const localY = Math.round(Number(payload.y) || 0);
    const x = parentBounds.x + Math.max(0, Math.min(parentBounds.width - width, localX));
    const y = parentBounds.y + Math.max(0, Math.min(parentBounds.height - height, localY));
    const popup = new BrowserWindow({
      parent,
      x,
      y,
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.popup = popup;
    const result = new Promise((resolve) => { this.pending = resolve; });
    const dismiss = () => { if (this.popup === popup) this.close(); };
    popup.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('dsh-workbench-menu://')) return;
      event.preventDefault();
      if (url.startsWith('dsh-workbench-menu://select/')) {
        const id = decodeURIComponent(new URL(url).pathname.slice(1));
        if (items.some((item) => item.id === id)) {
          this.close(id);
          return;
        }
      }
      dismiss();
    });
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.once('ready-to-show', () => {
      if (this.popup !== popup) return;
      popup.show();
      popup.focus();
    });
    popup.on('blur', dismiss);
    popup.on('closed', () => {
      if (this.popup === popup) {
        this.popup = null;
        const pending = this.pending;
        this.pending = null;
        pending?.(null);
      }
    });
    parent.on('move', dismiss);
    parent.on('resize', dismiss);
    parent.on('hide', dismiss);
    this.detachParent = () => {
      if (parent.isDestroyed()) return;
      parent.removeListener('move', dismiss);
      parent.removeListener('resize', dismiss);
      parent.removeListener('hide', dismiss);
    };
    const html = menuDocument({ heading: String(payload.heading || ''), items, dark: Boolean(payload.dark) });
    void popup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(dismiss);
    return result;
  }

  dispose() {
    this.close();
  }
}

module.exports = { WorkbenchMenu, menuDocument };
