"""Writes the 404 page: a small n8n workflow that stops at the page that is not there, with the message n8n itself
gives an HTTP 404 (n8n-workflow, NodeApiError)."""
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
out, n8n_workflow = WEB / "_site/404.html", WEB.parent / "node_modules/n8n-workflow"
MESSAGE = "The resource you are requesting could not be found"
assert f"'404': '{MESSAGE}'" in (n8n_workflow / "dist/cjs/errors/node-api.error.js").read_text()

page = """<!DOCTYPE html>
<html lang="en-US">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Page not found: n8n-nodes-ibm-quantum</title>
  <meta name="description" content="This page isn’t part of the site. Everything about the IBM Quantum node for n8n is on the home page.">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#10121c">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <style>
    :root {
      color-scheme: dark;
    }

    body {
      display: grid;
      place-items: center;
      min-height: 100vh;
      min-height: 100dvh;
      box-sizing: border-box;
      margin: 0;
      padding: 32px 16px;
      background: radial-gradient(ellipse 70% 55% at 50% 0%, rgba(145, 132, 217, 0.18), rgba(145, 132, 217, 0)) #10121c;
      color: #eeeef4;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      text-align: center;
      -webkit-font-smoothing: antialiased;
    }

    main {
      width: min(640px, 100%);
    }

    .canvas {
      padding: 30px 20px 24px;
      border-radius: 22px;
      background: linear-gradient(180deg, #161a2c, #10131f);
      box-shadow: 0 0 0 1px rgba(210, 212, 236, 0.12), 0 30px 70px rgba(0, 0, 0, 0.5);
    }

    ol {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 0;
      padding: 0;
      list-style: none;
    }

    li {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* The first connection carried the request, so it is green; the one after the failure never ran. */
    li:not(:last-child)::after {
      content: "";
      position: absolute;
      top: 29px;
      left: calc(50% + 29px);
      width: calc(100% - 58px);
      height: 2px;
      background: #3a4062;
    }

    li:first-child::after {
      background: linear-gradient(#6fd69c, #6fd69c) no-repeat 0 0 / 100% 100%, #3a4062;
    }

    .node {
      position: relative;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 58px;
      height: 58px;
      border-radius: 14px;
      background: linear-gradient(180deg, #252a44, #1c2034);
      box-shadow: inset 0 0 0 1.5px #3a4062, 0 0 0 0 rgba(168, 156, 228, 0);
      color: #a89ce4;
    }

    li:first-child .node {
      border-radius: 29px 14px 14px 29px;
      box-shadow: inset 0 0 0 1.5px #6fd69c, 0 0 0 0 rgba(168, 156, 228, 0);
    }

    .stopped .node {
      box-shadow: inset 0 0 0 1.5px #ff7b7b, 0 0 0 0 rgba(168, 156, 228, 0);
    }

    .skipped .node {
      color: #5d6185;
    }

    svg {
      width: 26px;
      height: 26px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .mark {
      position: absolute;
      right: -7px;
      bottom: -7px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #6fd69c;
      box-shadow: 0 0 0 3px #141728;
      color: #10131f;
    }

    .stopped .mark {
      background: #ff7b7b;
    }

    .mark svg {
      width: 20px;
      height: 20px;
      stroke-width: 2.2;
    }

    .name {
      margin-top: 12px;
      color: #a9abc0;
      font-size: 13px;
      line-height: 1.3;
    }

    .error {
      margin: 26px 0 0;
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(255, 123, 123, 0.08);
      box-shadow: inset 0 0 0 1px rgba(255, 123, 123, 0.35);
      text-align: left;
    }

    .error b {
      display: block;
      color: #ffb3b3;
      font-size: 15px;
      font-weight: 600;
    }

    .error code {
      display: block;
      margin-top: 6px;
      color: #c6c8da;
      font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    h1 {
      margin: 40px 0 0;
      font-size: clamp(30px, 6vw, 44px);
      font-weight: 700;
      letter-spacing: -0.015em;
    }

    p {
      margin: 14px 0 30px;
      color: #a9abc0;
      font-size: 19px;
      line-height: 1.45;
    }

    a {
      display: inline-block;
      padding: 13px 26px;
      border-radius: 999px;
      background: #a89ce4;
      color: #10121c;
      font-size: 17px;
      font-weight: 600;
      text-decoration: none;
      transition: background-color 0.2s;
    }

    a:hover {
      background: #cbc3f3;
    }

    a:focus-visible {
      outline: 3px solid #a89ce4;
      outline-offset: 3px;
    }

    /* The run plays once, the way n8n shows an execution: the first node runs and turns green, the request travels
       down the connection, Get page tries, fails and shakes, and n8n's error unrolls underneath. */
    @media (prefers-reduced-motion: no-preference) {
      li:first-child .node {
        animation: run 0.36s 0.3s both;
      }

      li:first-child .mark {
        animation: pop 0.42s 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      li:first-child .mark path {
        stroke-dasharray: 12;
        animation: draw 0.26s 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      li:first-child::after {
        animation: carry 0.3s 0.66s linear both;
      }

      .stopped .node {
        animation: get 2.26s both, shake 0.45s 1.96s both;
      }

      .stopped .mark {
        animation: pop 0.42s 2s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }

      /* Unrolled rather than faded in, so the message is either hidden or at its full contrast. */
      .error {
        animation: unroll 0.55s 2.25s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      @keyframes run {
        0% {
          box-shadow: inset 0 0 0 1.5px #3a4062, 0 0 0 0 rgba(168, 156, 228, 0.4);
        }

        25% {
          box-shadow: inset 0 0 0 1.5px #a89ce4, 0 0 0 0 rgba(168, 156, 228, 0.4);
        }

        85% {
          box-shadow: inset 0 0 0 1.5px #a89ce4, 0 0 0 10px rgba(168, 156, 228, 0);
        }
      }

      /* Waits for the request, tries twice, then turns red. */
      @keyframes get {
        0%,
        42.5% {
          box-shadow: inset 0 0 0 1.5px #3a4062, 0 0 0 0 rgba(168, 156, 228, 0.4);
        }

        46%,
        64.1% {
          box-shadow: inset 0 0 0 1.5px #a89ce4, 0 0 0 0 rgba(168, 156, 228, 0.4);
        }

        64%,
        84% {
          box-shadow: inset 0 0 0 1.5px #a89ce4, 0 0 0 10px rgba(168, 156, 228, 0);
        }

        86.7% {
          box-shadow: inset 0 0 0 1.5px #a89ce4, 0 0 0 0 rgba(168, 156, 228, 0);
        }
      }

      @keyframes pop {
        from {
          transform: scale(0);
        }
      }

      @keyframes draw {
        from {
          stroke-dashoffset: 12;
        }
      }

      @keyframes carry {
        from {
          background-size: 0 100%;
        }
      }

      @keyframes shake {
        20% {
          transform: translateX(-4px);
        }

        45% {
          transform: translateX(4px);
        }

        70% {
          transform: translateX(-2px);
        }

        90% {
          transform: translateX(1px);
        }
      }

      @keyframes unroll {
        from {
          clip-path: inset(0 0 100% 0 round 12px);
          transform: translateY(-6px);
        }

        to {
          clip-path: inset(0 0 0 0 round 12px);
        }
      }
    }

    @media (max-height: 640px) {
      body {
        padding-block: 24px;
      }

      .canvas {
        padding-top: 22px;
      }

      .error {
        margin-top: 18px;
      }

      h1 {
        margin-top: 26px;
      }

      p {
        margin: 10px 0 20px;
      }
    }

    /* A phone held sideways: the workflow and the way home matter more than the spacing. */
    @media (max-height: 460px) {
      body {
        padding: 16px;
      }

      .canvas {
        padding: 16px 16px 14px;
      }

      .node {
        width: 46px;
        height: 46px;
      }

      li:not(:last-child)::after {
        top: 23px;
        left: calc(50% + 23px);
        width: calc(100% - 46px);
      }

      svg {
        width: 22px;
        height: 22px;
      }

      .name {
        margin-top: 8px;
      }

      .error {
        margin-top: 12px;
        padding: 10px 14px;
      }

      h1 {
        margin-top: 16px;
        font-size: 28px;
      }

      p {
        margin: 8px 0 16px;
        font-size: 16px;
      }

      a {
        padding: 10px 22px;
      }
    }

    @media (max-width: 640px) {
      p {
        font-size: 17px;
      }

      .name {
        font-size: 12px;
      }
    }

    @media (max-width: 360px) {
      .canvas {
        padding-inline: 12px;
      }

      .error b {
        font-size: 14px;
      }
    }
  </style>
</head>
<body>
  <main>
    <div class="canvas" role="img" aria-label="An n8n workflow that stops at its second node, Get page, with the error: MESSAGE">
      <ol aria-hidden="true">
        <li><span class="node"><svg viewBox="0 0 24 24"><path d="M9 9 19.6 13l-4.9 1.7L13 19.6z"/><path d="M9 3.6v1.9M3.6 9h1.9M5.2 5.2l1.3 1.3"/></svg><i class="mark"><svg viewBox="0 0 20 20"><path d="m6 10.2 2.8 2.8 5.2-5.6"/></svg></i></span><span class="name">Open this address</span></li>
        <li class="stopped"><span class="node"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.4 5.1 3.4 8.5s-1.1 6.2-3.4 8.5c-2.3-2.3-3.4-5.1-3.4-8.5S9.7 5.8 12 3.5z"/></svg><i class="mark"><svg viewBox="0 0 20 20"><path d="M10 5.6v5.4"/><circle cx="10" cy="14.3" r="1.3" fill="currentColor" stroke="none"/></svg></i></span><span class="name">Get page</span></li>
        <li class="skipped"><span class="node"><svg viewBox="0 0 24 24"><path d="M2.7 12c2-3.8 5.3-6.2 9.3-6.2s7.3 2.4 9.3 6.2c-2 3.8-5.3 6.2-9.3 6.2S4.7 15.8 2.7 12z"/><circle cx="12" cy="12" r="2.8"/></svg></span><span class="name">Show it</span></li>
      </ol>
      <div class="error" aria-hidden="true">
        <b>MESSAGE</b>
        <code>404 · GET <span data-path>/this-page</span></code>
      </div>
    </div>
    <h1>This page isn’t in the workflow.</h1>
    <p>Nothing on this site answers at this address. Everything about the node is on the home page.</p>
    <a href="/">Go to the home page</a>
  </main>
  <script>
    // The address asked for, as the request would show it.
    let path = location.pathname;
    try { path = decodeURI(path); } catch {}
    document.querySelector("[data-path]").textContent = path;
  </script>
</body>
</html>
""".replace("MESSAGE", MESSAGE)
out.write_text(page)
print("404.html:", MESSAGE)
