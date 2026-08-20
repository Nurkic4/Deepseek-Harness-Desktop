window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-terminal",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		/**
		 * 「终端」视图：注册到 conversation.view，与 对话/轨迹/文件 并列。
		 * 宿主插件通过 WebSocket 提供当前会话项目目录下的持久 shell，
		 * xterm.js 负责完整终端渲染，ConPTY 负责交互式程序和终端尺寸同步。
		 */

		const TOKEN_KEY = "dsh.term.token";
		const SHELL_KEY = "dsh.term.shell";
		const TABS_KEY = "dsh.term.tabs";
		const MAX_TABS = 8;
		const tokenKeyFor = (sid, terminalId, shell) => [TOKEN_KEY, sid || "global", terminalId, shell].join(".");
		const tabsKeyFor = (sid) => TABS_KEY + "." + (sid || "global");
		const shellLabel = (shell) => shell === "powershell" ? "PowerShell 7" : "Git Bash";
		function newId() {
			return (crypto && typeof crypto.randomUUID === "function")
				? crypto.randomUUID()
				: "term-" + Date.now() + "-" + Math.random().toString(36).slice(2);
		}
		function savedShell() {
			try { return localStorage.getItem(SHELL_KEY) === "powershell" ? "powershell" : "git-bash"; }
			catch { return "git-bash"; }
		}

		function newToken(key) {
			const t = (crypto && typeof crypto.randomUUID === "function")
				? crypto.randomUUID()
				: "t-" + Date.now() + "-" + Math.random().toString(36).slice(2);
			try { localStorage.setItem(key, t); } catch {}
			return t;
		}
		function savedToken(key) {
			try { return localStorage.getItem(key) || ""; } catch { return ""; }
		}
		function defaultTab() {
			const shell = savedShell();
			return { id: newId(), shell, title: shellLabel(shell) + " 1" };
		}
		function loadTabs(sessionId) {
			try {
				const raw = localStorage.getItem(tabsKeyFor(sessionId));
				if (raw === null) return [defaultTab()];
				const parsed = JSON.parse(raw);
				if (!Array.isArray(parsed)) return [defaultTab()];
				return parsed.slice(0, MAX_TABS).flatMap((item) => {
					if (!item || typeof item.id !== "string" || !item.id) return [];
					const shell = item.shell === "powershell" ? "powershell" : "git-bash";
					const title = typeof item.title === "string" && item.title.trim()
						? item.title.trim().slice(0, 48)
						: shellLabel(shell);
					return [{ id: item.id, shell, title }];
				});
			} catch { return [defaultTab()]; }
		}
		function saveTabs(sessionId, tabs) {
			try { localStorage.setItem(tabsKeyFor(sessionId), JSON.stringify(tabs)); } catch {}
		}

		// -----------------------------------------------------------------------
		// 轻量 ANSI：把文本块解析成 [{text, cls}] 行；支持 SGR 前景色/加粗，
		// 其余控制序列剥离；\r 覆盖当前行（进度条场景）。
		// -----------------------------------------------------------------------

		const SGR_COLORS = {
			30: "c30", 31: "c31", 32: "c32", 33: "c33", 34: "c34",
			35: "c35", 36: "c36", 37: "c37",
			90: "c90", 91: "c91", 92: "c92", 93: "c93", 94: "c94",
			95: "c95", 96: "c96", 97: "c97"
		};

		function parseAnsiChunk(chunk, out, carry) {
			// carry: { lines: [{text, cls}], cur: {text, cls} }
			let text = String(chunk);
			let i = 0;
			const { cur, lines } = carry;
			const flush = (replace) => {
				if (replace && lines.length > 0) lines[lines.length - 1] = { text: cur.text, cls: cur.cls };
				else {
					lines.push({ text: cur.text, cls: cur.cls });
					if (lines.length > 8000) lines.splice(0, lines.length - 8000);
				}
				cur.text = "";
			};
			while (i < text.length) {
				const ch = text[i];
				if (ch === "\x1b") {
					const m = text.slice(i).match(/^\x1b\[([0-9;]*)m/);
					if (m) {
						i += m[0].length;
						let cls = cur.cls || "";
						for (const code of m[1].split(";")) {
							if (code === "" || code === "0") cls = "";
							else if (SGR_COLORS[code]) cls = (cls ? cls + " " : "") + SGR_COLORS[code];
							else if (code === "1") cls = (cls ? cls + " " : "") + "bold";
						}
						cur.cls = cls;
						continue;
					}
					const m2 = text.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
					if (m2) { i += m2[0].length; continue; } // 光标等控制序列：剥离
					i += 1; // 孤立 ESC
					continue;
				}
				if (ch === "\r") {
					// PowerShell writes CRLF. Treat that pair as a normal newline;
					// only a lone CR means "replace the current progress line".
					if (text[i + 1] === "\n") {
						flush(false);
						i += 2;
					} else {
						if (cur.text !== "") flush(true);
						i += 1;
					}
					continue;
				}
				if (ch === "\n") {
					flush(false);
					i += 1;
					continue;
				}
				if (ch === "\b") { cur.text = cur.text.slice(0, -1); i += 1; continue; }
				let j = i;
				while (j < text.length && text[j] !== "\n" && text[j] !== "\r" && text[j] !== "\x1b" && text[j] !== "\b") j++;
				cur.text += text.slice(i, j);
				i = j;
			}
			return out;
		}

		function renderChunk(chunk, state) {
			const carry = state.carry || (state.carry = { lines: [], cur: { text: "", cls: "" } });
			parseAnsiChunk(chunk, null, carry);
			return carry.lines;
		}

		let terminalAssetsPromise;
		function loadScript(src, ready) {
			if (ready()) return Promise.resolve();
			return new Promise((resolve, reject) => {
				const existing = document.querySelector('script[data-dsh-terminal-src="' + src + '"]');
				if (existing) {
					existing.addEventListener("load", resolve, { once: true });
					existing.addEventListener("error", reject, { once: true });
					return;
				}
				const script = document.createElement("script");
				script.src = src;
				script.dataset.dshTerminalSrc = src;
				script.onload = resolve;
				script.onerror = reject;
				document.head.appendChild(script);
			});
		}

		function loadTerminalAssets() {
			if (terminalAssetsPromise) return terminalAssetsPromise;
			let link = document.querySelector('link[data-dsh-terminal-css="xterm"]');
			if (!link) {
				link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = "/dsh-files/term/assets/xterm.css";
				link.dataset.dshTerminalCss = "xterm";
				document.head.appendChild(link);
			}
			terminalAssetsPromise = loadScript(
				"/dsh-files/term/assets/xterm.js",
				() => typeof window.Terminal === "function"
			).then(() => loadScript(
				"/dsh-files/term/assets/addon-fit.js",
				() => typeof window.FitAddon?.FitAddon === "function"
			)).catch((error) => {
				terminalAssetsPromise = undefined;
				throw error;
			});
			return terminalAssetsPromise;
		}

		function TerminalPane(props) {
			const sessionId = props.sessionId;
			const terminalId = props.terminalId;
			const [shellType, setShellType] = react.useState(props.initialShell);
			// 项目根目录：从宿主路由按会话 ID 查会话日志头（不依赖页面内部 hooks）。
			const [cwd, setCwd] = react.useState("");
			const [cwdLoading, setCwdLoading] = react.useState(true);
			react.useEffect(() => {
				let alive = true;
				setCwdLoading(true);
				if (sessionId) {
					fetch("/api/dsh-files/session-cwd?sessionId=" + encodeURIComponent(sessionId))
						.then((r) => r.json())
						.then((j) => { if (alive && j && typeof j.cwd === "string") setCwd(j.cwd); })
						.catch(() => {})
						.finally(() => { if (alive) setCwdLoading(false); });
				} else {
					setCwdLoading(false);
				}
				return () => { alive = false; };
			}, [sessionId]);

			const [status, setStatus] = react.useState("connecting");
			const [diag, setDiag] = react.useState("");
			const [terminalReady, setTerminalReady] = react.useState(false);
			const [searchOpen, setSearchOpen] = react.useState(false);
			const [searchQuery, setSearchQuery] = react.useState("");
			const [searchResult, setSearchResult] = react.useState({ index: 0, total: 0 });
			const [hasSelection, setHasSelection] = react.useState(false);
			const searchInputRef = react.useRef(null);
			const searchCursorRef = react.useRef(-1);
			// A1：token 跟随会话——切换会话时按新 sessionId 取/建 token；
			// 同一会话内保持稳定（切标签页/刷新 15 分钟内不丢 shell 状态）。
			const tokenRef = react.useRef("");
			const lastSessionRef = react.useRef(null);
			react.useEffect(() => {
				const key = tokenKeyFor(sessionId, terminalId, shellType);
				if (lastSessionRef.current === key) return;
				lastSessionRef.current = key;
				tokenRef.current = savedToken(key) || newToken(key);
			}, [sessionId, terminalId, shellType]);
			const terminalHostRef = react.useRef(null);
			const terminalRef = react.useRef(null);
			const fitRef = react.useRef(null);
			react.useEffect(() => {
				if (!props.active || !terminalReady) return;
				const frame = requestAnimationFrame(() => {
					try { fitRef.current?.fit(); } catch {}
					terminalRef.current?.focus();
				});
				return () => cancelAnimationFrame(frame);
			}, [props.active, terminalReady]);

			// 连接管理：cwd 用 ref 读取，避免 restart/connect 的闭包过期问题。
			// 通道用 WebSocket（升级连接不占浏览器对同主机的 HTTP/1.1 六连接池，
			// web UI 自身的长连接已把池占满，SSE 会被排队永远连不上）。
			const cwdRef = react.useRef("");
			cwdRef.current = cwd;
			const watchRef = react.useRef(null);
			const wsRef = react.useRef(null);
			const intentionalRef = react.useRef(false);
			const retryDelayRef = react.useRef(1000);
			const retryTimerRef = react.useRef(null);

			const sendTerminalData = react.useCallback((data) => {
				const ws = wsRef.current;
				if (ws && ws.readyState === 1) {
					try { ws.send(JSON.stringify({ type: "input", data })); } catch {}
				}
			}, []);

			react.useEffect(() => {
				if (!cwd || !terminalHostRef.current) return;
				let alive = true;
				let observer;
				let inputDisposable;
				let resizeDisposable;
				let selectionDisposable;
				loadTerminalAssets().then(() => {
					if (!alive || !terminalHostRef.current) return;
					const term = new window.Terminal({
						cursorBlink: true,
						convertEol: false,
						fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
						fontSize: 13,
						lineHeight: 1.2,
						scrollback: 10000,
						theme: {
							background: "#141418", foreground: "#d4d4d8", cursor: "#62d98b",
							selectionBackground: "#3d5f80", black: "#18181c", red: "#f08080",
							green: "#78d99a", yellow: "#e3c66d", blue: "#73b7f2",
							magenta: "#d39be2", cyan: "#67c6d2", white: "#e5e5e8"
						}
					});
					const fit = new window.FitAddon.FitAddon();
					term.loadAddon(fit);
					term.open(terminalHostRef.current);
					fit.fit();
					terminalRef.current = term;
					fitRef.current = fit;
					inputDisposable = term.onData(sendTerminalData);
					selectionDisposable = term.onSelectionChange(() => setHasSelection(term.hasSelection()));
					resizeDisposable = term.onResize(({ cols, rows }) => {
						const ws = wsRef.current;
						if (ws && ws.readyState === 1) {
							try { ws.send(JSON.stringify({ type: "resize", cols, rows })); } catch {}
						}
					});
					observer = new ResizeObserver(() => {
						try { fit.fit(); } catch {}
					});
					observer.observe(terminalHostRef.current);
					setTerminalReady(true);
					if (props.active) term.focus();
				}).catch((error) => {
					if (!alive) return;
					setDiag("终端组件加载失败: " + String((error && error.message) || error));
					setStatus("failed");
				});
				return () => {
					alive = false;
					observer?.disconnect();
					inputDisposable?.dispose();
					resizeDisposable?.dispose();
					selectionDisposable?.dispose();
					terminalRef.current?.dispose();
					terminalRef.current = null;
					fitRef.current = null;
				};
			}, [cwd, sendTerminalData]);

			const connect = react.useCallback(() => {
				const cur = cwdRef.current;
				const term = terminalRef.current;
				if (!cur || !term) { setStatus("failed"); return; }
				let ws;
				try {
					const proto = window.location.protocol === "https:" ? "wss" : "ws";
					ws = new WebSocket(
						proto + "://" + window.location.host +
						"/dsh-files/term/ws?token=" + encodeURIComponent(tokenRef.current) +
						"&cwd=" + encodeURIComponent(cur) +
						"&shell=" + encodeURIComponent(shellType) +
						"&cols=" + encodeURIComponent(term.cols) +
						"&rows=" + encodeURIComponent(term.rows)
					);
				} catch (err) {
					setStatus("failed");
					return;
				}
				wsRef.current = ws;
				intentionalRef.current = false;
				setStatus("connecting");
				if (watchRef.current) clearTimeout(watchRef.current);
				watchRef.current = setTimeout(() => {
					setStatus((s) => {
						if (s !== "connecting") return s;
						// 失败时用普通 fetch 探测宿主可达性（ports 路由无副作用）。
						fetch("/api/dsh-files/ports", {
							signal: AbortSignal.timeout(4000)
						}).then((r) => {
							setDiag("探测 fetch: HTTP " + r.status);
						}).catch((err) => {
							setDiag("探测 fetch 失败: " + String((err && err.message) || err));
						});
						return "failed";
					});
				}, 6000);
				const clearWatch = () => { if (watchRef.current) { clearTimeout(watchRef.current); watchRef.current = null; } };
				const handleMsg = (msg) => {
					if (!msg || typeof msg !== "object") return;
					if (msg.event === "snapshot") {
						try {
							term.reset();
							term.write(String(msg.data && msg.data.text || ""));
						} catch {}
					}
					else if (msg.event === "ready") {
						clearWatch();
						retryDelayRef.current = 1000;
						setStatus(msg.data && msg.data.exited ? "exited" : "ready");
						try { ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); } catch {}
					} else if (msg.event === "data") {
						try { term.write(String(msg.data && msg.data.text || "")); } catch {}
					} else if (msg.event === "exit") {
						clearWatch();
						const code = msg.data && msg.data.code;
						setStatus("exited");
						term.writeln("\r\n\x1b[33m[进程已退出" + (code === null || code === 0 || code === undefined ? "" : " · code " + code) + "，点击「重启」开启新会话]\x1b[0m");
					}
				};
				ws.onopen = () => { setStatus("connecting"); };
				ws.onmessage = (e) => {
					let msg;
					try { msg = JSON.parse(e.data); } catch { return; }
					handleMsg(msg);
				};
				ws.onclose = () => {
					clearWatch();
					// A shell switch can finish opening its replacement before the old
					// socket's close event arrives. Ignore that stale event so its old
					// connect closure cannot replace the newly selected shell.
					if (wsRef.current !== ws) return;
					wsRef.current = null;
					if (intentionalRef.current) return;
					// 非主动关闭：退避重连（1s→2s→…→15s 封顶）。
					setStatus((s) => (s === "exited" ? s : "retrying"));
					const delay = retryDelayRef.current;
					retryDelayRef.current = Math.min(delay * 2, 15000);
					if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
					retryTimerRef.current = setTimeout(() => connect(), delay);
				};
				ws.onerror = () => {};
			}, [shellType]);

			const selectShell = (next) => {
				if (next === shellType) return;
				intentionalRef.current = true;
				if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
				if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
				const old = tokenRef.current;
				if (old) {
					fetch("/dsh-files/term/close", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ token: old }),
						keepalive: true
					}).catch(() => {});
				}
				try { localStorage.setItem(SHELL_KEY, next); } catch {}
				terminalRef.current?.reset();
				setShellType(next);
				props.onShellChange(next);
			};

			const restart = react.useCallback(() => {
				intentionalRef.current = true;
				if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
				if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
				const old = tokenRef.current;
				tokenRef.current = newToken(tokenKeyFor(sessionId, terminalId, shellType));
				if (old) {
					try {
						fetch("/dsh-files/term/close", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ token: old }),
							keepalive: true
						}).catch(() => {});
					} catch {}
				}
				terminalRef.current?.reset();
				retryDelayRef.current = 1000;
				connect();
			}, [connect, sessionId, terminalId, shellType]);

			const stop = react.useCallback(() => {
				intentionalRef.current = true;
				if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
				if (watchRef.current) { clearTimeout(watchRef.current); watchRef.current = null; }
				if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
				const token = tokenRef.current;
				if (token) closeToken(token);
				setStatus("exited");
				terminalRef.current?.writeln("\r\n\x1b[33m[终端进程已由用户停止，点击「重启」可重新启动]\x1b[0m");
			}, []);

			const copySelection = react.useCallback(() => {
				const text = terminalRef.current?.getSelection() || "";
				if (!text) return;
				void navigator.clipboard.writeText(text).catch(() => {});
			}, []);

			const findInTerminal = react.useCallback((query, forward = true) => {
				setSearchQuery(query);
				const term = terminalRef.current;
				const normalized = query.toLocaleLowerCase();
				if (!term || !normalized) {
					term?.clearSelection();
					searchCursorRef.current = -1;
					setSearchResult({ index: 0, total: 0 });
					return;
				}
				const matches = [];
				const buffer = term.buffer.active;
				for (let row = 0; row < buffer.length; row += 1) {
					const text = buffer.getLine(row)?.translateToString(true) || "";
					const haystack = text.toLocaleLowerCase();
					let column = haystack.indexOf(normalized);
					while (column >= 0) {
						matches.push({ row, column });
						column = haystack.indexOf(normalized, column + Math.max(1, normalized.length));
					}
				}
				if (matches.length === 0) {
					term.clearSelection();
					searchCursorRef.current = -1;
					setSearchResult({ index: 0, total: 0 });
					return;
				}
				const previous = searchCursorRef.current;
				const index = forward
					? (previous + 1 + matches.length) % matches.length
					: (previous <= 0 ? matches.length - 1 : previous - 1);
				searchCursorRef.current = index;
				const match = matches[index];
				term.select(match.column, match.row, query.length);
				term.scrollToLine(match.row);
				setSearchResult({ index: index + 1, total: matches.length });
			}, []);

			react.useEffect(() => {
				if (!props.active) return;
				const onKeyDown = (event) => {
					if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
					const key = String(event.key || "").toLocaleLowerCase();
					if (key === "f") {
						event.preventDefault();
						setSearchOpen(true);
						requestAnimationFrame(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); });
					} else if (key === "c" && event.shiftKey && terminalRef.current?.hasSelection()) {
						event.preventDefault();
						copySelection();
					}
				};
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [copySelection, props.active]);

			react.useEffect(() => {
				if (!cwd || !terminalReady) return;
				connect();
				return () => {
					intentionalRef.current = true;
					if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
					if (watchRef.current) { clearTimeout(watchRef.current); watchRef.current = null; }
					if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
				};
			}, [cwd, connect, terminalReady]);

			if (!cwd) {
				return react_jsx_runtime.jsx("div", {
					className: "dsh-term-root",
					children: react_jsx_runtime.jsx("div", {
						className: "dsh-term-hint",
						children: cwdLoading ? "正在获取项目目录…" : "当前会话没有项目目录，无法启动终端。"
					})
				});
			}

			return react_jsx_runtime.jsxs("div", {
				className: "dsh-term-root",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "dsh-term-head",
						children: [
							react_jsx_runtime.jsx("span", {
								className: "dsh-term-cwd",
								title: cwd + " · session: " + (sessionId || "?"),
							children: cwd
							}),
							react_jsx_runtime.jsxs("div", {
								className: "dsh-term-shell-switch",
								role: "group",
								"aria-label": "终端类型",
								children: [
								react_jsx_runtime.jsx("button", {
										type: "button", className: shellType === "git-bash" ? "active" : "",
										"aria-pressed": shellType === "git-bash", onClick: () => selectShell("git-bash"), children: "Git Bash"
									}),
									react_jsx_runtime.jsx("button", {
										type: "button", className: shellType === "powershell" ? "active" : "",
										"aria-pressed": shellType === "powershell", onClick: () => selectShell("powershell"), children: "PowerShell 7"
									})
								]
							}),
							react_jsx_runtime.jsx("span", {
								className: "dsh-term-status dsh-term-status-" + status,
								children: status === "ready" ? "运行中" : status === "exited" ? "已退出" : status === "retrying" ? "重连中…" : status === "failed" ? "连接失败（点重启重试）" : "连接中…"
							}),
						react_jsx_runtime.jsx("button", {
								className: "dsh-term-btn",
								title: "查找 (Ctrl+F)",
								"aria-label": "查找终端输出",
								onClick: () => {
									setSearchOpen(true);
									requestAnimationFrame(() => searchInputRef.current?.focus());
								},
								children: "⌕"
							}),
							react_jsx_runtime.jsx("button", {
								className: "dsh-term-btn",
								title: "复制选中文本",
								"aria-label": "复制选中文本",
								disabled: !hasSelection,
								onClick: copySelection,
								children: "⧉"
							}),
							react_jsx_runtime.jsx("button", {
								className: "dsh-term-btn",
								title: "清屏",
								"aria-label": "清屏",
								onClick: () => terminalRef.current?.clear(),
								children: "⌫"
							}),
							react_jsx_runtime.jsx("button", {
								className: "dsh-term-btn",
								title: "停止终端进程",
								"aria-label": "停止终端进程",
								disabled: status === "exited",
								onClick: stop,
								children: "■"
							}),
							react_jsx_runtime.jsx("button", {
								className: "dsh-term-btn",
								title: "重启终端",
								"aria-label": "重启终端",
								onClick: restart,
								children: "↻"
							})
						]
					}),
					searchOpen && react_jsx_runtime.jsxs("form", {
						className: "dsh-term-search",
						onSubmit: (event) => { event.preventDefault(); findInTerminal(searchQuery, true); },
						children: [
							react_jsx_runtime.jsx("input", {
								ref: searchInputRef,
								value: searchQuery,
								placeholder: "查找终端输出",
								"aria-label": "查找终端输出",
								onChange: (event) => { searchCursorRef.current = -1; findInTerminal(event.target.value, true); },
								onKeyDown: (event) => {
									if (event.key === "Escape") { setSearchOpen(false); findInTerminal(""); terminalRef.current?.focus(); }
								}
							}),
							react_jsx_runtime.jsx("span", { children: searchResult.index + "/" + searchResult.total }),
							react_jsx_runtime.jsx("button", { type: "button", title: "上一个", onClick: () => findInTerminal(searchQuery, false), children: "↑" }),
							react_jsx_runtime.jsx("button", { type: "button", title: "下一个", onClick: () => findInTerminal(searchQuery, true), children: "↓" }),
							react_jsx_runtime.jsx("button", {
								type: "button", title: "关闭查找", children: "×",
								onClick: () => { setSearchOpen(false); findInTerminal(""); terminalRef.current?.focus(); }
							})
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: "dsh-term-body dsh-term-xterm",
						children: [
							react_jsx_runtime.jsx("div", { className: "dsh-term-xterm-host", ref: terminalHostRef }),
							status === "failed" && react_jsx_runtime.jsx("div", {
								className: "dsh-term-fail-overlay",
								children: diag || "无法建立终端连接，请点击右上角「重启」。"
							})
						]
					})
				]
			});
		}

		function closeToken(token) {
			if (!token) return;
			fetch("/dsh-files/term/close", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ token }),
				keepalive: true
			}).catch(() => {});
		}

		function nextTabTitle(tabs, shell) {
			const prefix = shellLabel(shell);
			let number = 1;
			const used = new Set(tabs.map((tab) => tab.title));
			while (used.has(prefix + " " + number)) number += 1;
			return prefix + " " + number;
		}

		function TerminalView(props) {
			const sessionId = props.sessionId;
			const initialTabs = react.useMemo(() => loadTabs(sessionId), [sessionId]);
			const [tabs, setTabs] = react.useState(initialTabs);
			const [activeId, setActiveId] = react.useState(() => initialTabs[0]?.id || null);
			const loadedSessionRef = react.useRef(sessionId);
			const skipSaveRef = react.useRef(false);

			react.useEffect(() => {
				if (loadedSessionRef.current === sessionId) return;
				skipSaveRef.current = true;
				loadedSessionRef.current = sessionId;
				const loaded = loadTabs(sessionId);
				setTabs(loaded);
				setActiveId(loaded[0]?.id || null);
			}, [sessionId]);

			react.useEffect(() => {
				if (skipSaveRef.current) { skipSaveRef.current = false; return; }
				saveTabs(sessionId, tabs);
			}, [sessionId, tabs]);

			const createTab = () => {
				if (tabs.length >= MAX_TABS) return;
				const current = tabs.find((tab) => tab.id === activeId);
				const shell = current?.shell || savedShell();
				const tab = { id: newId(), shell, title: nextTabTitle(tabs, shell) };
				setTabs((items) => [...items, tab]);
				setActiveId(tab.id);
			};

			const updateShell = (id, shell) => {
				setTabs((items) => items.map((tab) => tab.id === id ? { ...tab, shell } : tab));
			};

			const renameTab = (tab) => {
				const next = window.prompt("重命名终端", tab.title);
				if (next === null || !next.trim()) return;
				setTabs((items) => items.map((item) => item.id === tab.id
					? { ...item, title: next.trim().slice(0, 48) }
					: item));
			};

			const closeTab = (id) => {
				const index = tabs.findIndex((tab) => tab.id === id);
				if (index < 0) return;
				for (const shell of ["git-bash", "powershell"]) {
					const key = tokenKeyFor(sessionId, id, shell);
					closeToken(savedToken(key));
					try { localStorage.removeItem(key); } catch {}
				}
				const nextTabs = tabs.filter((tab) => tab.id !== id);
				setTabs(nextTabs);
				if (activeId === id) {
					setActiveId(nextTabs[index]?.id || nextTabs[index - 1]?.id || null);
				}
			};

			const moveTabFocus = (event, id) => {
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
				event.preventDefault();
				const index = tabs.findIndex((tab) => tab.id === id);
				if (index < 0 || tabs.length === 0) return;
				const nextIndex = event.key === "Home" ? 0
					: event.key === "End" ? tabs.length - 1
					: event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
					: (index + 1) % tabs.length;
				const nextId = tabs[nextIndex].id;
				setActiveId(nextId);
				requestAnimationFrame(() => document.getElementById("dsh-term-tab-" + nextId)?.focus());
			};

			return react_jsx_runtime.jsxs("div", {
				className: "dsh-term-workspace",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "dsh-term-tabs",
						role: "tablist",
						"aria-label": "终端会话",
						children: [
							...tabs.map((tab) => react_jsx_runtime.jsxs("div", {
								className: "dsh-term-tab" + (tab.id === activeId ? " active" : ""),
								children: [
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: "dsh-term-tab-main",
										role: "tab",
										id: "dsh-term-tab-" + tab.id,
										"aria-selected": tab.id === activeId,
										"aria-controls": "dsh-term-panel-" + tab.id,
										title: tab.title + "（双击重命名）",
										onClick: () => setActiveId(tab.id),
										onDoubleClick: () => renameTab(tab),
										onKeyDown: (event) => moveTabFocus(event, tab.id),
										children: tab.title
									}),
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: "dsh-term-tab-close",
										"aria-label": "关闭 " + tab.title,
										title: "关闭终端",
										onClick: () => closeTab(tab.id),
										children: "×"
									})
								]
							}, tab.id)),
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: "dsh-term-tab-add",
								"aria-label": tabs.length >= MAX_TABS ? "最多打开 8 个终端" : "新建终端",
								title: tabs.length >= MAX_TABS ? "最多打开 8 个终端" : "新建终端",
								disabled: tabs.length >= MAX_TABS,
								onClick: createTab,
								children: "+"
							})
						]
					}),
					tabs.length === 0
						? react_jsx_runtime.jsx("div", { className: "dsh-term-empty", children: "点击 + 新建终端" })
						: react_jsx_runtime.jsx("div", {
							className: "dsh-term-stage",
							children: tabs.map((tab) => react_jsx_runtime.jsx("section", {
								className: "dsh-term-pane" + (tab.id === activeId ? " active" : ""),
								role: "tabpanel",
								id: "dsh-term-panel-" + tab.id,
								"aria-labelledby": "dsh-term-tab-" + tab.id,
								"aria-hidden": tab.id !== activeId,
								children: react_jsx_runtime.jsx(TerminalPane, {
									sessionId,
									terminalId: tab.id,
									initialShell: tab.shell,
									active: tab.id === activeId,
									onShellChange: (shell) => updateShell(tab.id, shell)
								})
							}, tab.id))
						})
				]
			});
		}

		const CSS = [
			".dsh-term-workspace{display:flex;flex-direction:column;height:100%;min-height:0;background:#16161a;color:#d4d4d4;box-sizing:border-box}",
			".dsh-term-tabs{display:flex;align-items:stretch;gap:2px;min-height:34px;overflow-x:auto;overflow-y:hidden;padding:4px 6px 0;border-bottom:1px solid #2b2b31;background:#111114;box-sizing:border-box;scrollbar-width:thin}",
			".dsh-term-tab{display:flex;align-items:center;flex:0 0 auto;min-width:112px;max-width:220px;height:29px;border:1px solid transparent;border-bottom:0;border-radius:4px 4px 0 0;background:#1c1c21;color:#96969f;box-sizing:border-box}",
			".dsh-term-tab:hover{background:#24242a;color:#d7d7dc}",
			".dsh-term-tab.active{border-color:#383840;background:#2b2b32;color:#f1f1f3}",
			".dsh-term-tab-main{appearance:none;min-width:0;flex:1;height:100%;overflow:hidden;padding:0 6px 0 9px;border:0;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:28px;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}",
			".dsh-term-tab-close,.dsh-term-tab-add{appearance:none;display:inline-grid;place-items:center;flex:0 0 auto;width:26px;height:26px;padding:0;border:0;border-radius:4px;background:transparent;color:#8b8b94;font:16px/1 Consolas,'Courier New',monospace;cursor:pointer}",
			".dsh-term-tab-close:hover,.dsh-term-tab-add:hover{background:#393941;color:#f1f1f3}",
			".dsh-term-tab-add{margin-left:2px;border:1px solid transparent;font-size:18px}",
			".dsh-term-tab-add:disabled{opacity:.4;cursor:not-allowed}",
			".dsh-term-tab-main:focus-visible,.dsh-term-tab-close:focus-visible,.dsh-term-tab-add:focus-visible{outline:2px solid #6aa9ff;outline-offset:-2px}",
			".dsh-term-stage{position:relative;flex:1;min-height:0}",
			".dsh-term-pane{position:absolute;inset:0;visibility:hidden;pointer-events:none}",
			".dsh-term-pane.active{visibility:visible;pointer-events:auto}",
			".dsh-term-empty{display:grid;place-items:center;flex:1;min-height:0;color:#7f7f88;font-size:12px}",
			".dsh-term-root{display:flex;flex-direction:column;height:100%;background:#16161a;color:#d4d4d4;font-family:var(--ds-font-family-code,Consolas,'Courier New',monospace);box-sizing:border-box}",
			".dsh-term-hint{display:flex;align-items:center;justify-content:center;height:100%;color:#8a8a8a;font-size:12px}",
			".dsh-term-head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #2b2b31;flex:none}",
			".dsh-term-cwd{flex:1;min-width:0;font-size:11px;color:#8a8a8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}",
			".dsh-term-shell-switch{display:inline-flex;flex:none;border:1px solid #33333b;border-radius:6px;overflow:hidden}",
			".dsh-term-shell-switch button{appearance:none;border:0;border-inline-end:1px solid #33333b;background:transparent;color:#9b9ba3;padding:3px 8px;font:inherit;font-size:10.5px;cursor:pointer}",
			".dsh-term-shell-switch button:last-child{border-inline-end:0}",
			".dsh-term-shell-switch button:hover{background:#26262c;color:#e4e4e8}",
			".dsh-term-shell-switch button.active{background:#34343c;color:#f1f1f3}",
			".dsh-term-shell-switch button:focus-visible{outline:2px solid #6aa9ff;outline-offset:-2px}",
			".dsh-term-status{font-size:10.5px;flex:none}",
			".dsh-term-status-ready{color:#4ec97c}",
			".dsh-term-status-exited{color:#e08a4e}",
			".dsh-term-status-retrying{color:#d8b64e}",
			".dsh-term-status-failed{color:#ff8a8a}",
			".dsh-term-status-connecting{color:#8a8a8a}",
			".dsh-term-btn{appearance:none;display:inline-grid;place-items:center;width:28px;height:26px;padding:0;border:1px solid #33333b;background:transparent;color:#b8b8c0;border-radius:6px;font-size:14px;cursor:pointer;flex:none}",
			".dsh-term-btn:hover{background:#26262c;color:#e4e4e8}",
			".dsh-term-btn:disabled{opacity:.38;cursor:default}",
			".dsh-term-search{display:flex;align-items:center;gap:4px;flex:none;align-self:flex-end;height:36px;margin:5px 8px 0;padding:3px 4px 3px 8px;border:1px solid #33333b;border-radius:6px;background:#202026;color:#9b9ba3;font-size:11px;box-sizing:border-box}",
			".dsh-term-search input{width:min(220px,26vw);min-width:100px;height:26px;padding:0;border:0;outline:0;background:transparent;color:#e4e4e8;font:12px/18px Consolas,'Courier New',monospace}",
			".dsh-term-search button{display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:4px;background:transparent;color:#b8b8c0;cursor:pointer}",
			".dsh-term-search button:hover{background:#393941;color:#f1f1f3}",
			".dsh-term-body{flex:1;min-height:0;box-sizing:border-box}",
			".dsh-term-xterm{position:relative;overflow:hidden;padding:0}",
			".dsh-term-xterm-host{position:absolute;inset:0;overflow:hidden}",
			".dsh-term-xterm-host .xterm{height:100%;padding:8px 10px;box-sizing:border-box}",
			".dsh-term-xterm-host .xterm-viewport{overflow-y:auto!important}",
			".dsh-term-fail-overlay{position:absolute;left:12px;right:12px;bottom:12px;z-index:2;padding:8px 10px;border:1px solid #74373f;border-radius:6px;background:#3a1f24;color:#ffb0b0;font-size:12px;line-height:18px;pointer-events:none}",
			".dsh-term-line{white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:18px;min-height:18px}",
			".dsh-term-line.cmd{color:#7fc8ff}",
			".dsh-term-line.exit{color:#e08a4e}",
			".dsh-term-line.dsh-term-fail{color:#ff8a8a;background:#3a1f24;border-radius:6px;padding:6px 8px;margin-bottom:6px;white-space:normal}",
			".dsh-term-line.bold{font-weight:700}",
			".dsh-term-line.c30{color:#1a1a1a}.dsh-term-line.c31{color:#e06c75}.dsh-term-line.c32{color:#98c379}.dsh-term-line.c33{color:#e5c07b}.dsh-term-line.c34{color:#61afef}.dsh-term-line.c35{color:#c678dd}.dsh-term-line.c36{color:#56b6c2}.dsh-term-line.c37{color:#d4d4d4}",
			".dsh-term-line.c90{color:#5c6370}.dsh-term-line.c91{color:#f27d86}.dsh-term-line.c92{color:#a9d491}.dsh-term-line.c93{color:#eacf8e}.dsh-term-line.c94{color:#79b7f0}.dsh-term-line.c95{color:#d39be2}.dsh-term-line.c96{color:#67c6d2}.dsh-term-line.c97{color:#e4e4e8}"
		].join("");

		const TAG = "@deepseek-ai/dsh-terminal/client.css";
		function ensureCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG) + "]")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-terminal";
			tag.dataset.pluginCss = TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		const inject = ["slots"];

		function apply(ctx) {
			ensureCss();
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "terminal",
				order: 30,
				label: () => "终端"
			}, TerminalView), "dsh-terminal: conversation view entry");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
