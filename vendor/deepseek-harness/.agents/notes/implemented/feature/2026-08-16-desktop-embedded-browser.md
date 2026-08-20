# Agent Note: Desktop embedded browser

Status: implemented

## Problem

Desktop users need to browse and authenticate inside DSH while allowing the model to inspect and operate the exact page they can see. An iframe cannot reliably embed sites that set frame restrictions, and a separate automation browser would split user and model state.

## Decision

The desktop shell owns a persistent Electron `WebContentsView` browser partition. A companion client plugin contributes a Browser conversation tab with tabs, an address field, navigation controls, and bounds reporting. The native view is shown only while that conversation tab is active.

The companion host plugin registers snapshot, navigation, interaction, tab, history, scrolling, and screenshot tools. It reaches the shell through a random-port loopback HTTP service protected by a per-process bearer token. The DSH process receives the address and token only through inherited environment variables. Page snapshots label web content as untrusted data and mask password and payment-card values.

## Alternatives considered

**Iframe embedding.** This would keep the implementation in the Web UI, but common sites reject framing and cross-origin access prevents reliable inspection and interaction.

**A separate Playwright browser.** This offers mature automation, but the model would operate a different browser process and login state from the page visible to the user.

**Screenshot streaming.** This avoids native view composition but does not provide a real interactive browser and creates input latency and accessibility limitations.

## Consequences

The user and model share tabs, cookies, navigation, and visible page state. Native view bounds must track the Web UI layout, and desktop shutdown must explicitly close child web contents and the local bridge. Web page text remains untrusted and must never become model instructions.
