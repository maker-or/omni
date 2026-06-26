export const AUTH_CALLBACK_SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Signed in — pipper</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Averia+Serif+Libre:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        --bg: #fffdf4;
        --fg: #0c3a8f;
        --fg-muted: #5474af;
        --page-gutter: clamp(1.5rem, 5vw, 2.5rem);
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      html {
        color-scheme: light;
        height: 100%;
      }

      body {
        background: var(--bg);
        color: var(--fg);
        font-family: "Averia Serif Libre", serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        min-height: 100svh;
      }

      .page {
        min-height: 100svh;
        display: flex;
        flex-direction: column;
      }

      .page-container {
        width: 100%;
        max-width: 80rem;
        margin-inline: auto;
        padding-inline: var(--page-gutter);
      }

      .site-header {
        padding-top: clamp(1.5rem, 3vw, 2.5rem);
      }

      .site-logo {
        font-style: italic;
        font-size: clamp(1.75rem, 4vw, 2.25rem);
        line-height: 1;
        letter-spacing: -0.025em;
        color: var(--fg-muted);
      }

      .shell {
        flex: 1;
        display: grid;
        place-items: center;
        padding: 2rem var(--page-gutter) 3rem;
      }

      .message {
        text-align: center;
        max-width: 28rem;
        animation: fade-in 1s ease-out forwards;
      }

      .message h1 {
        font-size: clamp(1.5rem, 4vw, 2rem);
        font-weight: 400;
        letter-spacing: -0.03em;
        line-height: 1.2;
        color: var(--fg);
        margin-bottom: 0.5rem;
      }

      .message p {
        font-size: 1rem;
        line-height: 1.5;
        color: var(--fg-muted);
      }

      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="site-header page-container">
        <span class="site-logo">pipper</span>
      </header>
      <main class="shell">
        <section class="message">
          <h1>Signed in</h1>
          <p>You can return to Pipper Code (Alpha).</p>
        </section>
      </main>
    </div>
  </body>
</html>`;
