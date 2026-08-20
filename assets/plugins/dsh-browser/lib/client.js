window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-browser",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");

    const EMPTY_STATE = {
      available: true, visible: false, activeTabId: null, tabs: [], maxTabs: 8, closedTabCount: 0,
    };

    function activeTab(state) {
      return state.tabs.find((tab) => tab.id === state.activeTabId) || state.tabs[0] || null;
    }

    function IconButton({ label, title = label, disabled, active, onClick, children }) {
      return jsx("button", {
        type: "button",
        className: "dsh-browser-icon" + (active ? " active" : ""),
        "aria-label": label,
        title,
        disabled,
        onClick,
        children,
      });
    }

    function BrowserView() {
      const bridge = window.dshDesktop;
      const stageRef = React.useRef(null);
      const addressRef = React.useRef(null);
      const findRef = React.useRef(null);
      const addressEditing = React.useRef(false);
      const [state, setState] = React.useState(EMPTY_STATE);
      const [address, setAddress] = React.useState("");
      const [commandError, setCommandError] = React.useState("");
      const [findOpen, setFindOpen] = React.useState(false);
      const [findQuery, setFindQuery] = React.useState("");
      const current = activeTab(state);

      const command = React.useCallback(async (name, args = {}) => {
        setCommandError("");
        try {
          return await bridge.browserCommand(name, args);
        } catch (error) {
          setCommandError(error && error.message ? error.message : String(error));
          return null;
        }
      }, [bridge]);

      React.useEffect(() => {
        let alive = true;
        bridge.browserCommand("state").then((next) => { if (alive && next) setState(next); }).catch(() => {});
        const offState = bridge.onBrowserState((next) => { if (alive && next) setState(next); });
        const offFocus = bridge.onBrowserFocusAddress(() => {
          addressRef.current?.focus();
          addressRef.current?.select();
        });
        const offFind = bridge.onBrowserFocusFind?.(() => {
          setFindOpen(true);
          requestAnimationFrame(() => { findRef.current?.focus(); findRef.current?.select(); });
        });
        return () => {
          alive = false;
          offState?.();
          offFocus?.();
          offFind?.();
        };
      }, [bridge]);

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
          const key = String(event.key || "").toLowerCase();
          if (key === "f") {
            event.preventDefault();
            setFindOpen(true);
            requestAnimationFrame(() => { findRef.current?.focus(); findRef.current?.select(); });
          } else if (key === "t" && event.shiftKey) {
            event.preventDefault();
            void command("reopenClosedTab");
          }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, [command]);

      React.useEffect(() => {
        if (!addressEditing.current) setAddress(current?.url === "about:blank" ? "" : current?.url || "");
      }, [current?.url, current?.id]);

      React.useLayoutEffect(() => {
        let frame = 0;
        const report = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) return;
            void bridge.browserCommand("setBounds", {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }).catch(() => {});
          });
        };
        const observer = new ResizeObserver(report);
        if (stageRef.current) observer.observe(stageRef.current);
        window.addEventListener("resize", report);
        void bridge.browserCommand("show").then(report).catch((error) => {
          setCommandError(error && error.message ? error.message : String(error));
        });
        return () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          window.removeEventListener("resize", report);
          void bridge.browserCommand("hide").catch(() => {});
        };
      }, [bridge, current?.id]);

      const submitAddress = (event) => {
        event.preventDefault();
        if (!address.trim()) return;
        void command("navigate", { url: address });
        addressRef.current?.blur();
      };

      const closeTab = (event, id) => {
        event.stopPropagation();
        void command("closeTab", { id });
      };

      const runFind = (query, options = {}) => {
        setFindQuery(query);
        void command("findInPage", { query, ...options });
      };

      const closeFind = () => {
        setFindOpen(false);
        setFindQuery("");
        void command("stopFindInPage");
      };

      return jsxs("div", {
        className: "dsh-browser-root",
        children: [
          jsx("div", { "data-conversation-composer-overlay": "", hidden: true }),
          jsxs("div", {
            className: "dsh-browser-tabs",
            role: "tablist",
            children: [
              state.tabs.map((tab) => jsxs("div", {
                className: "dsh-browser-tab" + (tab.id === state.activeTabId ? " active" : ""),
                role: "tab",
                "aria-selected": tab.id === state.activeTabId,
                title: tab.title,
                onClick: () => { void command("selectTab", { id: tab.id }); },
                children: [
                  jsx("span", { className: "dsh-browser-tab-status", "aria-hidden": "true", children: tab.loading ? "◌" : "●" }),
                  jsx("span", { className: "dsh-browser-tab-title", children: tab.title || "新标签页" }),
                  jsx("button", {
                    type: "button",
                    className: "dsh-browser-tab-close",
                    "aria-label": `关闭 ${tab.title || "标签页"}`,
                    title: "关闭标签页",
                    onClick: (event) => closeTab(event, tab.id),
                    children: "×",
                  }),
                ],
              }, tab.id)),
              jsx(IconButton, {
                label: "新建标签页",
                title: state.tabs.length >= state.maxTabs ? `最多打开 ${state.maxTabs} 个标签页` : "新建标签页 (Ctrl+T)",
                disabled: state.tabs.length >= state.maxTabs,
                onClick: () => { void command("newTab", {}); },
                children: "+",
              }),
              jsx(IconButton, {
                label: "恢复关闭的标签页",
                title: "恢复关闭的标签页 (Ctrl+Shift+T)",
                disabled: !state.closedTabCount || state.tabs.length >= state.maxTabs,
                onClick: () => { void command("reopenClosedTab"); },
                children: "↶",
              }),
              jsx(IconButton, {
                label: "复制当前标签页",
                disabled: !current || state.tabs.length >= state.maxTabs,
                onClick: () => { void command("duplicateTab", { id: current?.id }); },
                children: "□",
              }),
              jsx(IconButton, {
                label: "复制当前网址",
                disabled: !current || current.url === "about:blank",
                onClick: () => { void command("copyUrl"); },
                children: "⧉",
              }),
            ],
          }),
          jsxs("div", {
            className: "dsh-browser-toolbar",
            children: [
              jsx(IconButton, {
                label: "后退",
                disabled: !current?.canGoBack,
                onClick: () => { void command("back"); },
                children: "←",
              }),
              jsx(IconButton, {
                label: "前进",
                disabled: !current?.canGoForward,
                onClick: () => { void command("forward"); },
                children: "→",
              }),
              jsx(IconButton, {
                label: current?.loading ? "停止加载" : "重新加载",
                onClick: () => { void command(current?.loading ? "stop" : "reload"); },
                children: current?.loading ? "×" : "↻",
              }),
              jsxs("form", {
                className: "dsh-browser-address-wrap",
                onSubmit: submitAddress,
                children: [
                  jsx("span", {
                    className: "dsh-browser-security",
                    title: current?.url?.startsWith("https:") ? "HTTPS 安全连接" : "非加密连接",
                    "aria-hidden": "true",
                    children: current?.url?.startsWith("https:") ? "◆" : "◇",
                  }),
                  jsx("input", {
                    ref: addressRef,
                    className: "dsh-browser-address",
                    value: address,
                    "aria-label": "地址和搜索",
                    placeholder: "搜索或输入网址",
                    spellCheck: false,
                    onFocus: () => { addressEditing.current = true; },
                    onBlur: () => { addressEditing.current = false; },
                    onChange: (event) => setAddress(event.target.value),
                  }),
                ],
              }),
              jsx(IconButton, {
                label: "在页面中查找",
                title: "在页面中查找 (Ctrl+F)",
                disabled: !current,
                active: findOpen,
                onClick: () => {
                  setFindOpen(true);
                  requestAnimationFrame(() => { findRef.current?.focus(); findRef.current?.select(); });
                },
                children: "⌕",
              }),
              jsx(IconButton, {
                label: "在系统浏览器中打开",
                title: "在系统浏览器中打开",
                disabled: !current || current.url === "about:blank",
                onClick: () => { void command("openExternal"); },
                children: "↗",
              }),
              jsx(IconButton, { label: "缩小页面", title: "缩小页面", disabled: !current, onClick: () => { void command("zoomOut"); }, children: "−" }),
              jsx(IconButton, { label: "放大页面", title: "放大页面", disabled: !current, onClick: () => { void command("zoomIn"); }, children: "+" }),
              jsx(IconButton, { label: "重置页面缩放", title: "重置页面缩放", disabled: !current, onClick: () => { void command("resetZoom"); }, children: "1:1" }),
              jsx(IconButton, { label: "打印页面", title: "打印页面为 PDF", disabled: !current || current.url === "about:blank", onClick: () => { void command("print"); }, children: "⎙" }),
              jsx(IconButton, { label: "打开开发者工具", title: "打开开发者工具", disabled: !current, onClick: () => { void command("devtools"); }, children: "⌘" }),
              jsx(IconButton, { label: "清除站点数据", title: "清除当前站点 Cookie 和存储", disabled: !current || current.url === "about:blank", onClick: () => { if (window.confirm("清除当前站点的 Cookie 和存储数据？")) void command("clearSiteData"); }, children: "⌫" }),
            ],
          }),
          findOpen && jsxs("form", {
            className: "dsh-browser-find",
            onSubmit: (event) => {
              event.preventDefault();
              runFind(findQuery, { findNext: true, forward: true });
            },
            children: [
              jsx("input", {
                ref: findRef,
                value: findQuery,
                className: "dsh-browser-find-input",
                "aria-label": "在页面中查找",
                placeholder: "查找",
                onChange: (event) => runFind(event.target.value),
                onKeyDown: (event) => { if (event.key === "Escape") closeFind(); },
              }),
              jsx("span", {
                className: "dsh-browser-find-count",
                "aria-live": "polite",
                children: current?.find?.query
                  ? `${current.find.activeMatchOrdinal || 0}/${current.find.matches || 0}`
                  : "0/0",
              }),
              jsx(IconButton, {
                label: "上一个匹配项",
                disabled: !findQuery,
                onClick: () => runFind(findQuery, { findNext: true, forward: false }),
                children: "↑",
              }),
              jsx(IconButton, {
                label: "下一个匹配项",
                disabled: !findQuery,
                onClick: () => runFind(findQuery, { findNext: true, forward: true }),
                children: "↓",
              }),
              jsx(IconButton, { label: "关闭查找", onClick: closeFind, children: "×" }),
            ],
          }),
          current?.loading && jsx("div", { className: "dsh-browser-progress", role: "progressbar" }),
          (commandError || current?.error) && jsx("div", {
            className: "dsh-browser-error",
            role: "alert",
            children: commandError || current.error,
          }),
          jsx("div", {
            ref: stageRef,
            className: "dsh-browser-stage",
            "aria-label": "内置浏览器页面",
          }),
        ],
      });
    }

    const CSS = [
      ".dsh-browser-root{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-sizing:border-box}",
      ".dsh-browser-tabs{display:flex;align-items:flex-end;gap:2px;flex:none;height:36px;padding:5px 8px 0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-sidebar-fill);box-sizing:border-box;scrollbar-width:thin}",
      ".dsh-browser-tab{display:flex;align-items:center;gap:6px;flex:0 1 210px;min-width:104px;max-width:240px;height:30px;padding:0 4px 0 10px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;color:var(--dsw-alias-label-tertiary);background:transparent;box-sizing:border-box;cursor:pointer}",
      ".dsh-browser-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".dsh-browser-tab.active{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-tab-status{flex:none;font-size:7px;color:var(--dsw-alias-label-caption)}",
      ".dsh-browser-tab.active .dsh-browser-tab-status{color:var(--dsw-alias-state-business-primary)}",
      ".dsh-browser-tab-title{min-width:0;flex:1;overflow:hidden;font-size:12px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}",
      ".dsh-browser-tab-close{display:grid;place-items:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;font:16px/1 var(--ds-font-family-code,monospace);cursor:pointer}",
      ".dsh-browser-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-toolbar{display:grid;grid-template-columns:30px 30px 30px minmax(120px,1fr) 30px 30px;align-items:center;gap:4px;flex:none;height:44px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-sizing:border-box}",
      ".dsh-browser-icon{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:18px/1 var(--ds-font-family-code,monospace);cursor:pointer}",
      ".dsh-browser-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".dsh-browser-icon:disabled{opacity:.38;cursor:default}",
      ".dsh-browser-icon:focus-visible,.dsh-browser-tab-close:focus-visible,.dsh-browser-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}",
      ".dsh-browser-address-wrap{display:flex;align-items:center;min-width:0;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);box-sizing:border-box}",
      ".dsh-browser-address-wrap:focus-within{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}",
      ".dsh-browser-security{flex:none;margin-right:7px;color:var(--dsw-alias-label-caption);font-size:9px}",
      ".dsh-browser-address{min-width:0;flex:1;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:12px/18px var(--ds-font-family-code,monospace)}",
      ".dsh-browser-address::placeholder{color:var(--dsw-alias-label-caption)}",
      ".dsh-browser-find{display:flex;align-items:center;gap:3px;flex:none;align-self:flex-end;height:40px;margin:6px 10px 0;padding:3px 4px 3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);box-sizing:border-box}",
      ".dsh-browser-find:focus-within{border-color:var(--dsw-alias-state-business-primary)}",
      ".dsh-browser-find-input{width:min(220px,28vw);min-width:100px;height:28px;padding:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:12px/18px var(--ds-font-family-code,monospace)}",
      ".dsh-browser-find-count{min-width:42px;color:var(--dsw-alias-label-caption);font-size:11px;text-align:center}",
      ".dsh-browser-progress{position:relative;z-index:2;flex:none;height:2px;overflow:hidden;background:var(--dsw-alias-border-l1)}",
      ".dsh-browser-progress::after{content:'';display:block;width:34%;height:100%;background:var(--dsw-alias-state-business-primary);animation:dsh-browser-progress 1.1s ease-in-out infinite}",
      "@keyframes dsh-browser-progress{from{transform:translateX(-110%)}to{transform:translateX(310%)}}",
      ".dsh-browser-error{flex:none;max-height:56px;overflow:auto;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-error);font-size:12px;line-height:18px;box-sizing:border-box}",
      ".dsh-browser-stage{position:relative;flex:1;min-height:80px;background:var(--dsw-alias-bg-base)}",
      "@media (prefers-reduced-motion:reduce){.dsh-browser-progress::after{animation:none;width:100%}}",
      "@media (max-width:700px){.dsh-browser-tab{flex-basis:150px;max-width:180px}.dsh-browser-toolbar{padding-inline:6px;gap:2px}}",
    ].join("");

    function ensureCss() {
      if (document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-browser/client.css"]')) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "@deepseek-ai/dsh-browser";
      tag.dataset.pluginCss = "@deepseek-ai/dsh-browser/client.css";
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const inject = ["slots"];
    function apply(ctx) {
      const bridge = window.dshDesktop;
      if (!bridge || typeof bridge.browserCommand !== "function") return;
      ensureCss();
      ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view",
        id: "browser",
        order: 40,
        label: () => "浏览器",
      }, BrowserView), "dsh-browser: embedded desktop browser view");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
